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
const syncStatus = document.getElementById('syncStatus');

// State
let isGenerating = false;
let currentDownloadUrl = null;
let currentDownloadName = '';

// Wait for Firebase to be ready
function waitForFirebase() {
    return new Promise((resolve) => {
        if (window.firebaseReady) {
            resolve();
        } else {
            window.addEventListener('firebase-ready', resolve);
        }
    });
}

// Load Data on Init
document.addEventListener('DOMContentLoaded', async () => {
    loadCommunes();
    await waitForFirebase();
    loadHistory();
});

// 1. Load Communes
async function loadCommunes() {
    try {
        const response = await fetch('./communes.json');
        const communes = await response.json();

        // Sort alphabetically by name
        communes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        communeSelect.innerHTML = '<option value="" disabled selected>Choisir une commune...</option>';
        communes.forEach(c => {
            const option = document.createElement('option');
            // communes.json uses "code" and "name" keys
            option.value = c.code;
            option.textContent = c.name;
            option.dataset.name = c.name;
            communeSelect.appendChild(option);
        });
    } catch (err) {
        console.error("Error loading communes:", err);
        if (window.location.protocol === 'file:') {
            alert("Mode local: Veuillez utiliser un serveur web (http-server ou Live Server).");
        }
    }
}

// 2. History Management (Firebase Firestore)
async function getHistory() {
    try {
        const db = window.firebaseDb;
        const q = window.firebaseQuery(
            window.firebaseCollection(db, 'intervals'),
            window.firebaseOrderBy('date', 'desc'),
            window.firebaseLimit(50)
        );
        const snapshot = await window.firebaseGetDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.error("Error fetching history from Firestore:", err);
        return [];
    }
}

async function saveToHistory(record) {
    try {
        const db = window.firebaseDb;
        await window.firebaseAddDoc(window.firebaseCollection(db, 'intervals'), record);
        updateSyncStatus('saved');
        loadHistory();
    } catch (err) {
        console.error("Error saving to Firestore:", err);
        updateSyncStatus('error');
    }
}

async function loadHistory() {
    updateSyncStatus('loading');
    const history = await getHistory();
    historyTable.innerHTML = '';

    if (history.length === 0) {
        historyTable.innerHTML = '<tr><td colspan="5" style="text-align:center">Aucune génération récente</td></tr>';
        updateSyncStatus('synced');
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
    updateSyncStatus('synced');
}

async function checkDuplicate(communeCode, start, end) {
    try {
        const db = window.firebaseDb;
        const q = window.firebaseQuery(
            window.firebaseCollection(db, 'intervals'),
            window.firebaseWhere('communeCode', '==', communeCode)
        );
        const snapshot = await window.firebaseGetDocs(q);
        const records = snapshot.docs.map(doc => doc.data());

        for (let record of records) {
            if (start <= record.end && end >= record.start) {
                return `Conflit avec l'intervalle ${record.start}-${record.end} (généré le ${new Date(record.date).toLocaleDateString('fr-FR')})`;
            }
        }
        return null;
    } catch (err) {
        console.error("Error checking duplicates:", err);
        return null; // Allow generation if check fails (rather than block)
    }
}

function updateSyncStatus(status) {
    if (!syncStatus) return;
    switch (status) {
        case 'loading':
            syncStatus.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Synchronisation...';
            syncStatus.style.color = '#64748b';
            break;
        case 'synced':
            syncStatus.innerHTML = '<i class="bi bi-cloud-check"></i> Synchronisé';
            syncStatus.style.color = '#16a34a';
            break;
        case 'saved':
            syncStatus.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Sauvegardé';
            syncStatus.style.color = '#0ea5e9';
            break;
        case 'error':
            syncStatus.innerHTML = '<i class="bi bi-cloud-slash"></i> Erreur Sync';
            syncStatus.style.color = '#ef4444';
            break;
    }
}

// 3. Export History
document.getElementById('exportHistoryBtn').addEventListener('click', async () => {
    const history = await getHistory();
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

    const communeCode = communeSelect.value;
    const communeName = communeSelect.options[communeSelect.selectedIndex].dataset.name;
    const start = parseInt(document.getElementById('intervalStart').value);
    const end = parseInt(document.getElementById('intervalEnd').value);
    const count = end - start + 1;
    const mode = document.querySelector('input[name="mode"]:checked').value;

    if (!communeCode || isNaN(start) || isNaN(end) || start > end) {
        alert("Veuillez vérifier les champs.");
        return;
    }

    // Check duplicate in Firestore
    progressStatus.textContent = "Vérification des doublons...";
    const conflict = await checkDuplicate(communeCode, start, end);
    if (conflict) {
        alert("Erreur de duplication !\n" + conflict);
        return;
    }

    // Start UI
    isGenerating = true;
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Traitement...';
    progressSection.classList.remove('hidden');
    resultSection.classList.add('hidden');
    progressBar.style.width = '0%';
    progressCount.textContent = `0 / ${count}`;
    progressStatus.textContent = "Initialisation...";

    try {
        const qrImages = [];

        for (let i = 0; i < count; i++) {
            const currentId = start + i;
            const fullId = `${communeCode}${currentId}`;

            progressStatus.textContent = `Génération du QR Code pour ID: ${currentId}`;
            progressCount.textContent = `${i + 1} / ${count}`;
            progressBar.style.width = `${((i + 1) / count) * 100}%`;

            await new Promise(r => setTimeout(r, 0));

            const base64Img = await generateQRCode(fullId);
            qrImages.push({
                id: currentId,
                fullId: fullId,
                data: base64Img
            });
        }

        progressStatus.textContent = mode === 'individual' ? "Création de l'archive ZIP..." : "Génération du PDF...";
        await new Promise(r => setTimeout(r, 100));

        if (mode === 'individual') {
            await createZip(qrImages, communeName);
        } else {
            await createPdf(qrImages, communeName);
        }

        // Save to Firestore
        const record = {
            date: new Date().toISOString(),
            communeCode,
            communeName,
            start,
            end,
            count,
            mode
        };
        await saveToHistory(record);

        progressSection.classList.add('hidden');
        resultSection.classList.remove('hidden');

    } catch (err) {
        console.error(err);
        alert("Une erreur est survenue lors de la génération: " + err);
        progressSection.classList.add('hidden');
    } finally {
        isGenerating = false;
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="bi bi-lightning-charge-fill"></i> Lancer la Génération';
    }
});

// Helper: Generate QR Base64
function generateQRCode(text) {
    return new Promise((resolve, reject) => {
        qrContainer.innerHTML = '';

        new QRCode(qrContainer, {
            text: text,
            width: 1000,
            height: 1000,
            correctLevel: QRCode.CorrectLevel.H
        });

        setTimeout(() => {
            const canvas = qrContainer.querySelector('canvas');
            if (canvas) {
                resolve(canvas.toDataURL("image/png"));
            } else {
                const img = qrContainer.querySelector('img');
                if (img) resolve(img.src);
                else reject("QR generation failed");
            }
        }, 50);
    });
}

// Helper: Create ZIP
async function createZip(images, communeName) {
    const zip = new JSZip();
    const folder = zip.folder(`QR_${communeName}`);

    images.forEach(img => {
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

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const cols = 3;
    const rows = 4;

    const cardWidth = 60;
    const cardHeight = 70;

    const xGap = (pageWidth - (margin * 2) - (cols * cardWidth)) / (cols - 1);
    const yGap = (pageHeight - (margin * 2) - (rows * cardHeight)) / (rows - 1);

    let x = margin;
    let y = margin;
    let col = 0;
    let row = 0;

    for (let i = 0; i < images.length; i++) {
        if (i > 0 && i % (cols * rows) === 0) {
            doc.addPage();
            col = 0;
            row = 0;
            x = margin;
            y = margin;
        }

        doc.setDrawColor(200);
        doc.rect(x, y, cardWidth, cardHeight);

        doc.setFontSize(8);
        doc.setTextColor(30, 58, 138);
        doc.text("PROCASEF", x + cardWidth / 2, y + 5, { align: 'center' });

        doc.addImage(images[i].data, 'PNG', x + 10, y + 10, 40, 40);

        doc.setFontSize(10);
        doc.setTextColor(0);
        doc.text(communeName, x + cardWidth / 2, y + 55, { align: 'center' });

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(images[i].fullId, x + cardWidth / 2, y + 62, { align: 'center' });

        col++;
        x += cardWidth + xGap;
        if (col >= cols) {
            col = 0;
            x = margin;
            row++;
            y += cardHeight + yGap;
        }
    }

    const blob = doc.output('blob');
    currentDownloadUrl = URL.createObjectURL(blob);
    currentDownloadName = `Planche_QR_${communeName}.pdf`;

    setupDownload();
}

function setupDownload() {
    downloadBtn.onclick = () => {
        const link = document.createElement('a');
        link.href = currentDownloadUrl;
        link.download = currentDownloadName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
}
