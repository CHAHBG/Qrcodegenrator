// DOM Elements
const form = document.getElementById('generateForm');
const communeSelect = document.getElementById('communeSelect');
const generateBtn = document.getElementById('generateBtn');
const progressSection = document.getElementById('progressSection');
const resultSection = document.getElementById('resultSection');
const progressBar = document.getElementById('progressBar');
const progressCount = document.getElementById('progressCount');
const progressStatus = document.getElementById('progressStatus');
const historyTable = document.getElementById('historyTable').querySelector('tbody');
const downloadBtn = document.getElementById('downloadBtn');
const qrContainer = document.getElementById('qr-hidden-container');

// State
let isGenerating = false;
let currentDownloadUrl = null;
let currentDownloadName = '';

// Load Data on Init
document.addEventListener('DOMContentLoaded', () => {
    loadCommunes();
    loadHistory();
});

// 1. Load Communes
async function loadCommunes() {
    try {
        const response = await fetch('./communes.json');
        const communes = await response.json();

        // Sort alphabetically
        communes.sort((a, b) => a.Commune.localeCompare(b.Commune));

        communeSelect.innerHTML = '<option value="" disabled selected>Choisir une commune...</option>';
        communes.forEach(c => {
            const option = document.createElement('option');
            // Assuming structure is { "Code_Commune": "...", "Commune": "..." }
            option.value = c.Code_Commune;
            option.textContent = c.Commune;
            option.dataset.name = c.Commune; // Store name for display
            communeSelect.appendChild(option);
        });
    } catch (err) {
        console.error("Error loading communes:", err);
        // Fallback for demo if file missing or CORS issue locally without server
        if (window.location.protocol === 'file:') {
            alert("Mode local (fichier): Les communes ne peuvent pas être chargées dynamiquement sans serveur web local. Veuillez utiliser 'http-server' ou VS Code Live Server.");
        }
    }
}

// 2. History Management (LocalStorage)
function getHistory() {
    const history = localStorage.getItem('qr_history');
    return history ? JSON.parse(history) : [];
}

function saveToHistory(record) {
    const history = getHistory();
    history.unshift(record); // Add to top
    localStorage.setItem('qr_history', JSON.stringify(history));
    loadHistory();
}

function loadHistory() {
    const history = getHistory();
    historyTable.innerHTML = '';

    if (history.length === 0) {
        historyTable.innerHTML = '<tr><td colspan="5" style="text-align:center">Aucune génération récente</td></tr>';
        return;
    }

    history.forEach(rec => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${new Date(rec.date).toLocaleString('fr-FR')}</td>
            <td><strong>${rec.communeName}</strong></td>
            <td>${rec.start} - ${rec.end} (${rec.count})</td>
            <td>${rec.mode === 'individual' ? 'ZIP' : 'PDF'}</td>
            <td><span class="badge" style="background:#dcfce7; color:#166534">Succès</span></td>
        `;
        historyTable.appendChild(row);
    });
}

function checkDuplicate(communeCode, start, end) {
    const history = getHistory();
    // Filter history for same commune
    const conflicts = history.filter(h => h.communeCode === communeCode);

    for (let record of conflicts) {
        // Check for overlap
        // Overlap if (StartA <= EndB) and (EndA >= StartB)
        if (start <= record.end && end >= record.start) {
            return `Conflit avec l'intervalle ${record.start}-${record.end} (généré le ${new Date(record.date).toLocaleDateString()})`;
        }
    }
    return null;
}

// 3. Export History
document.getElementById('exportHistoryBtn').addEventListener('click', () => {
    const history = getHistory();
    if (!history.length) {
        alert("Aucun historique à exporter.");
        return;
    }

    const csvContent = "data:text/csv;charset=utf-8,"
        + "Date,Code Commune,Nom Commune,Debut,Fin,Quantite,Mode\n"
        + history.map(e => `${e.date},${e.communeCode},${e.communeName},${e.start},${e.end},${e.count},${e.mode}`).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "historique_qr_procasef.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// 4. Generation Logic
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isGenerating) return;

    // Get Values
    const communeCode = communeSelect.value;
    const communeName = communeSelect.options[communeSelect.selectedIndex].dataset.name;
    const start = parseInt(document.getElementById('intervalStart').value);
    const end = parseInt(document.getElementById('intervalEnd').value);
    const count = end - start + 1;
    const mode = document.querySelector('input[name="mode"]:checked').value;

    // Validate
    if (!communeCode || isNaN(start) || isNaN(end) || start > end) {
        alert("Veuillez vérifier les champs.");
        return;
    }

    const conflict = checkDuplicate(communeCode, start, end);
    if (conflict) {
        alert("Erreur de duplication !\n" + conflict);
        return;
    }

    // Start UI
    isGenerating = true;
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Traitement...';
    progressSection.classList.remove('hidden');
    resultSection.classList.add('hidden');
    progressBar.style.width = '0%';
    progressCount.textContent = `0 / ${count}`;
    progressStatus.textContent = "Initialisation...";

    try {
        const qrImages = [];

        // Loop Generation
        for (let i = 0; i < count; i++) {
            const currentId = start + i;
            const fullId = `${communeCode}${currentId}`;

            // Update UI
            progressStatus.textContent = `Génération du QR Code pour ID: ${currentId}`;
            progressCount.textContent = `${i + 1} / ${count}`;
            progressBar.style.width = `${((i + 1) / count) * 100}%`;

            // Wait for UI render
            await new Promise(r => setTimeout(r, 0));

            // Generate QR
            const base64Img = await generateQRCode(fullId);
            qrImages.push({
                id: currentId,
                fullId: fullId,
                data: base64Img
            });
        }

        // Finalize (ZIP or PDF)
        progressStatus.textContent = mode === 'individual' ? "Création de l'archive ZIP..." : "Génération du PDF...";
        await new Promise(r => setTimeout(r, 100)); // UI Breath

        if (mode === 'individual') {
            await createZip(qrImages, communeName);
        } else {
            await createPdf(qrImages, communeName);
        }

        // Success
        const record = {
            date: new Date().toISOString(),
            communeCode,
            communeName,
            start,
            end,
            count,
            mode
        };
        saveToHistory(record);

        progressSection.classList.add('hidden');
        resultSection.classList.remove('hidden');

    } catch (err) {
        console.error(err);
        alert("Une erreur est survenue lors de la génération: " + err);
        progressSection.classList.add('hidden');
    } finally {
        isGenerating = false;
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Lancer la Génération';
    }
});

// Helper: Generate QR Base64
function generateQRCode(text) {
    return new Promise((resolve, reject) => {
        qrContainer.innerHTML = '';

        // Use QRCode.js library
        // We render to a hidden div, then get the canvas
        // Note: QRCode.js puts a canvas inside the container
        new QRCode(qrContainer, {
            text: text,
            width: 1000, // High res for print
            height: 1000,
            correctLevel: QRCode.CorrectLevel.H
        });

        // Wait for canvas to be drawn
        setTimeout(() => {
            const canvas = qrContainer.querySelector('canvas');
            if (canvas) {
                resolve(canvas.toDataURL("image/png"));
            } else {
                // Fallback for img tag (some browsers/versions)
                const img = qrContainer.querySelector('img');
                if (img) resolve(img.src);
                else reject("QR generation failed");
            }
        }, 50); // Small delay for library to render
    });
}

// Helper: Create ZIP
async function createZip(images, communeName) {
    const zip = new JSZip();
    const folder = zip.folder(`QR_${communeName}`);

    images.forEach(img => {
        // Strip base64 prefix
        const data = img.data.split(',')[1];
        folder.file(`${img.fullId}.png`, data, { base64: true });
    });

    const content = await zip.generateAsync({ type: "blob" });
    currentDownloadUrl = URL.createObjectURL(content);
    currentDownloadName = `QR_Codes_${communeName}_${images.length}.zip`;

    setupDownload();
}

// Helper: Create PDF
async function createPdf(images, communeName) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
    });

    // A4: 210 x 297 mm
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const cols = 3;
    const rows = 4; // 12 per page

    // Card dimensions
    const cardWidth = 60;
    const cardHeight = 70;

    // Gaps
    const xGap = (pageWidth - (margin * 2) - (cols * cardWidth)) / (cols - 1);
    const yGap = (pageHeight - (margin * 2) - (rows * cardHeight)) / (rows - 1);

    let x = margin;
    let y = margin;
    let col = 0;
    let row = 0;

    for (let i = 0; i < images.length; i++) {
        // Add Page if full
        if (i > 0 && i % (cols * rows) === 0) {
            doc.addPage();
            col = 0;
            row = 0;
            x = margin;
            y = margin;
        }

        // Draw Card Border (Optional, maybe lighter)
        doc.setDrawColor(200);
        doc.rect(x, y, cardWidth, cardHeight);

        // --- Content ---

        // 1. Logo Left (PROCASEF/Banque Mondiale)
        // Since we are client side, we rely on checking if images exist. 
        // For now, let's use text header if logos aren't pre-loaded base64.
        // Or simpler: Text Header "PROCASEF"
        doc.setFontSize(8);
        doc.setTextColor(30, 58, 138); // Navy
        doc.text("PROCASEF", x + cardWidth / 2, y + 5, { align: 'center' });

        // 2. QR Code (Centered)
        // QR is 40x40mm
        doc.addImage(images[i].data, 'PNG', x + 10, y + 10, 40, 40);

        // 3. Commune Name
        doc.setFontSize(10);
        doc.setTextColor(0);
        doc.text(communeName, x + cardWidth / 2, y + 55, { align: 'center' });

        // 4. ID (Bold)
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(images[i].fullId, x + cardWidth / 2, y + 62, { align: 'center' });

        // Move Position
        col++;
        x += cardWidth + xGap;
        if (col >= cols) {
            col = 0;
            x = margin;
            row++;
            y += cardHeight + yGap; // Use calculated yGap to spread vertically
        }
    }

    const blob = doc.output('blob');
    currentDownloadUrl = URL.createObjectURL(blob);
    currentDownloadName = `Planche_QR_${communeName}.pdf`;

    setupDownload();
}

function setupDownload() {
    // Setup the main 'Download' button action
    downloadBtn.onclick = () => {
        const link = document.createElement('a');
        link.href = currentDownloadUrl;
        link.download = currentDownloadName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
}
