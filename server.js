
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const archiver = require('archiver');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// SSE Clients
let clients = [];


// Data paths
const COMMUNES_FILE = path.join(__dirname, 'communes.json');
const INTERVALS_FILE = path.join(__dirname, 'intervals.json');
const OUTPUT_DIR = path.join(__dirname, 'output');

// External script paths - ABSOLUTE PATHS to avoid issues
const NODE_GENERATOR_PATH = String.raw`c:\Users\ASUS\Documents\Procasef_BETPLUS\Application\Qr_code generator\Qr_code generator\node_qr_generator\generator.js`;
const PYTHON_PRINT_PATH = String.raw`c:\Users\ASUS\Documents\Procasef_BETPLUS\Application\Qr_code generator\Qr_code generator\Qr_code for print.py`;

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
}

// Initialize intervals file if not exists
if (!fs.existsSync(INTERVALS_FILE)) {
    fs.writeFileSync(INTERVALS_FILE, JSON.stringify({}));
}

// Routes

// SSE Endpoint
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const clientId = Date.now();
    const newClient = {
        id: clientId,
        res
    };
    clients.push(newClient);

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
    });
});

function broadcast(data) {
    clients.forEach(client => {
        client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

// Get communes
app.get('/api/communes', (req, res) => {
    if (fs.existsSync(COMMUNES_FILE)) {
        const data = fs.readFileSync(COMMUNES_FILE);
        res.json(JSON.parse(data));
    } else {
        res.json([]);
    }
});

// Get History
app.get('/api/history', (req, res) => {
    if (!fs.existsSync(INTERVALS_FILE)) {
        return res.json([]);
    }

    // Flatten intervals into a list
    const intervals = JSON.parse(fs.readFileSync(INTERVALS_FILE));
    const communesData = fs.existsSync(COMMUNES_FILE) ? JSON.parse(fs.readFileSync(COMMUNES_FILE)) : [];

    // Create a map for quick name lookup
    const communeMap = {};
    communesData.forEach(c => communeMap[c.code] = c.name);

    let history = [];

    for (const [code, list] of Object.entries(intervals)) {
        const cName = communeMap[code] || code;
        list.forEach(item => {
            history.push({
                communeName: cName,
                start: item.start,
                end: item.end,
                timestamp: item.timestamp,
                count: item.end - item.start + 1
            });
        });
    }

    // Sort by timestamp descending (newest first)
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(history);
});

// Check interval availability
app.post('/api/check-interval', (req, res) => {
    const { communeCode, start, end } = req.body;
    const result = checkInterval(communeCode, start, end);
    res.json(result);
});

function checkInterval(communeCode, start, end) {
    if (!fs.existsSync(INTERVALS_FILE)) {
        return { available: true };
    }

    const intervals = JSON.parse(fs.readFileSync(INTERVALS_FILE));
    const communeIntervals = intervals[communeCode] || [];

    const startNum = parseInt(start);
    const endNum = parseInt(end);

    for (const interval of communeIntervals) {
        // Check for overlap
        // Interval A: [startNum, endNum]
        // Interval B: [interval.start, interval.end]
        const iStart = parseInt(interval.start);
        const iEnd = parseInt(interval.end);

        if (Math.max(startNum, iStart) <= Math.min(endNum, iEnd)) {
            return {
                available: false,
                message: `Interval overlaps with existing range [${iStart} - ${iEnd}]`
            };
        }
    }
    return { available: true };
}

// Generate QR Codes
app.post('/api/generate', async (req, res) => {
    const { communeCode, communeName, start, end, mode } = req.body;
    // mode: 'individual' or 'print'

    const startNum = parseInt(start);
    const endNum = parseInt(end);
    const count = endNum - startNum + 1;

    console.log(`Generating for ${communeName} (${communeCode}): ${startNum} to ${endNum} (${mode})`);

    // 1. Strict Duplicate Check
    const check = checkInterval(communeCode, startNum, endNum);
    if (!check.available) {
        return res.status(400).json({ error: check.message });
    }

    // 2. Update intervals immediately to reserve them
    const intervals = JSON.parse(fs.readFileSync(INTERVALS_FILE));
    if (!intervals[communeCode]) intervals[communeCode] = [];
    intervals[communeCode].push({ start: startNum, end: endNum, timestamp: new Date().toISOString() });
    fs.writeFileSync(INTERVALS_FILE, JSON.stringify(intervals, null, 2));

    // 2. Prepare Batch File for Node Generator
    const batchTasks = [];
    const jobDir = path.join(OUTPUT_DIR, `${communeName}_${startNum}_${endNum}`);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir);

    for (let i = startNum; i <= endNum; i++) {
        // ID Format: [CodeCommune 8 chars][Sequence 5 chars]
        // Example: 1312020170000. Wait, user said "start with an ID of 70000".
        // And "SYSCOL_Commune codes... e.g. [SYSCOL_Commune]70000".
        // The sequence i should be the 70000 part.

        // Ensure i is treated as the suffix.
        const id = `${communeCode}${i}`;

        batchTasks.push({
            data: id,
            out: path.join(jobDir, `${id}.png`),
            options: {
                preset: "rounded", // requested "rounded"
                outputMode: "card", // requested "card"
                communeName: communeName,
                // Hardcoded paths to logos based on previous file listings or assumptions?
                // I need to be sure about logo paths. 
                // The prompt said: include "Banque Mondiale" and "BETPLUSAUDETAG" logos.
                // In `node_qr_generator/test_batch.json` we saw:
                // "topLogoPath": ... "Banque Mondiale.jpg"
                // "imagePath": ... "BETPLUSAUDETAG.jpg"
                topLogoPath: String.raw`c:\Users\ASUS\Documents\Procasef_BETPLUS\Application\Qr_code generator\Qr_code generator\node_qr_generator\Img\Banque Mondiale.jpg`,
                imagePath: String.raw`c:\Users\ASUS\Documents\Procasef_BETPLUS\Application\Qr_code generator\Qr_code generator\node_qr_generator\Img\BETPLUSAUDETAG.jpg`,

                // Other options from previous conversations or defaults
                cardWidth: 800,
                cardHeight: 1100,
                rasterize: true,
                onlyPng: true,
                centerImageInsideQR: true
            }
        });
    }

    const batchFile = path.join(jobDir, 'batch.json');
    fs.writeFileSync(batchFile, JSON.stringify(batchTasks, null, 2));

    // 3. Run Node Generator
    // "node generator.js --batch tasks.json"
    // generator.js is in a different folder. I need to make sure to run it correctly.
    // The generator might rely on relative paths for "Img/..." if not absolute.
    // I used absolute paths in the batch options, so it should be fine.

    // 4. Run Node Generator using SPAWN to stream output
    // const cmd = `node "${NODE_GENERATOR_PATH}" --batch "${batchFile}"`; 
    // We use spawn specifically to capture stdout in real time

    broadcast({ type: 'start', message: `Démarrage de la génération pour ${count} QR codes...` });

    const { spawn } = require('child_process');
    const generatorProcess = spawn('node', [NODE_GENERATOR_PATH, '--batch', batchFile], {
        cwd: path.dirname(NODE_GENERATOR_PATH)
    });

    generatorProcess.stdout.on('data', (data) => {
        const output = data.toString();
        // console.log(`[GEN]: ${output}`);
        // node_qr_generator/generator.js likely prints something.
        // We broadcast lines as progress updates.
        broadcast({ type: 'progress', message: output.trim() });
    });

    generatorProcess.stderr.on('data', (data) => {
        console.error(`[GEN ERR]: ${data}`);
    });

    generatorProcess.on('close', (code) => {
        if (code !== 0) {
            console.error(`Generator exited with code ${code}`);
            return res.status(500).json({ error: 'Generation failed', details: `Exited with code ${code}` });
        }

        console.log("Generator finished.");
        broadcast({ type: 'progress', message: "Génération des images terminée. Finalisation..." });

        // 5. Handle output based on mode
        if (mode === 'print') {
            console.log("Mode is print. Generating PDF...");
            broadcast({ type: 'progress', message: "Génération du fichier PDF..." });

            // Generate PDF using Python logic
            const wrapperScriptPath = path.join(jobDir, 'run_print.py');
            const pdfName = `${communeName}_${startNum}_${endNum}.pdf`;
            const pdfOutput = path.join(jobDir, pdfName);

            // Escaping backslashes for python string
            const inputDirpy = jobDir.replace(/\\/g, '\\\\');
            const outputPdfpy = pdfOutput.replace(/\\/g, '\\\\');

            // Python script content matching original logic exactly
            const pythonScriptContent = `
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
import os
from PIL import Image

def create_qr_pdf(input_folder, output_pdf, images_per_row=4, rows_per_page=2, margin=30, row_spacing=20):
    image_files = [f for f in os.listdir(input_folder)
                   if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif'))]
    
    if not image_files:
        print("No images found.")
        return

    # Sort numerically by ID if possible
    try:
        image_files.sort(key=lambda x: int(''.join(filter(str.isdigit, x))))
    except:
        image_files.sort()

    width, height = landscape(A4)
    c = canvas.Canvas(output_pdf, pagesize=landscape(A4))
    page_number = 1
    
    # Calculate available space
    available_width = (width - 2 * margin - (images_per_row - 1) * 20) / images_per_row
    available_height = (height - 2 * margin - (rows_per_page - 1) * row_spacing) / rows_per_page
    
    original_ratio = 252 / 415
    available_ratio = available_width / available_height
    
    if available_ratio > original_ratio:
        qr_height = available_height * 0.98
        qr_width = qr_height * original_ratio
    else:
        qr_width = available_width * 0.98
        qr_height = qr_width / original_ratio

    images_per_page = images_per_row * rows_per_page
    block_width = (width - 2 * margin) / images_per_row
    block_height = (height - 2 * margin - (rows_per_page - 1) * row_spacing) / rows_per_page
    
    for i, image_file in enumerate(image_files):
        if i % images_per_page == 0 and i > 0:
            c.setFont("Helvetica", 10)
            c.drawCentredString(width / 2, 15, f"Page {page_number}")
            c.showPage()
            page_number += 1
            
        col = i % images_per_row
        row = (i // images_per_row) % rows_per_page
        
        x_base = margin + (col * block_width)
        y_base = height - margin - ((row + 1) * block_height) - (row * row_spacing)
        
        x_qr = x_base + (block_width - qr_width) / 2
        y_qr = y_base + (block_height - qr_height) / 2
        
        try:
            img_path = os.path.join(input_folder, image_file)
            img = Image.open(img_path)
            # Resize logic from original script
            img = img.resize((252, 415), Image.Resampling.LANCZOS)
            c.drawImage(ImageReader(img), x_qr, y_qr, width=qr_width, height=qr_height)
        except Exception as e:
            print(f"Error {image_file}: {e}")
            continue
            
    c.setFont("Helvetica", 10)
    c.drawCentredString(width / 2, 15, f"Page {page_number}")
    c.save()

if __name__ == "__main__":
    create_qr_pdf(r"${inputDirpy}", r"${outputPdfpy}")
            `;

            fs.writeFileSync(wrapperScriptPath, pythonScriptContent);

            exec(`python "${wrapperScriptPath}"`, (pyErr, pyOut, pyStdErr) => {
                if (pyErr) {
                    console.error("Python Error", pyErr);
                    return res.status(500).json({ error: 'PDF Generation failed', details: pyStdErr });
                }

                // For print mode, we return the PDF directly
                // We must move the PDF to the output root or serve it from jobDir
                // Our static server serves /output -> OUTPUT_DIR
                // The file is currently in OUTPUT_DIR/jobDir/file.pdf
                // So the URL should be /output/dir/file.pdf

                // Let's verify if the file exists
                if (!fs.existsSync(pdfOutput)) {
                    return res.status(500).json({ error: 'PDF file was not created' });
                }

                const downloadUrl = `/output/${communeName}_${startNum}_${endNum}/${pdfName}`;
                broadcast({ type: 'complete', message: "Génération PDF terminée." });
                res.json({ success: true, downloadUrl: downloadUrl });
            });

        } else {
            // Individual Mode: Zip images
            console.log("Mode is individual. Zipping images...");
            broadcast({ type: 'progress', message: "Compression des images en cours..." });
            const zipName = `${communeName}_${startNum}_${endNum}.zip`;
            const zipPath = path.join(OUTPUT_DIR, zipName);
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', function () {
                console.log(archive.pointer() + ' total bytes');
                broadcast({ type: 'complete', message: "Génération Zip terminée." });
                res.json({ success: true, downloadUrl: `/output/${zipName}` });
            });

            archive.on('error', function (err) {
                res.status(500).json({ error: err.message });
            });

            archive.pipe(output);

            // Glob pattern to match only images in the job directory
            archive.glob('*.png', { cwd: jobDir });
            // Also include jpg if any (logos usually aren't generated here but just in case)
            // archive.glob('*.jpg', { cwd: jobDir });

            archive.finalize();
        }
    });

});

// Serve output files
app.use('/output', express.static(OUTPUT_DIR));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
