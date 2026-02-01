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

// Logo base64 cache
let logoCache = {
    banqueMondiale: null,
    betplus: null
};

// Preload logos on init
async function preloadLogos() {
    try {
        const [bm, bp] = await Promise.all([
            loadImageAsBase64('./assets/banque_mondiale.jpg'),
            loadImageAsBase64('./assets/betplus.jpg')
        ]);
        logoCache.banqueMondiale = bm;
        logoCache.betplus = bp;
        console.log('Logos preloaded successfully');
    } catch (err) {
        console.warn('Could not preload logos:', err);
    }
}

function loadImageAsBase64(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/jpeg'));
        };
        img.onerror = reject;
        img.src = src;
    });
}

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
    preloadLogos();
    await waitForFirebase();
    loadHistory();
});

// 1. Load Communes
async function loadCommunes() {
    try {
        const response = await fetch('./communes.json');
        const communes = await response.json();

        communes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        communeSelect.innerHTML = '<option value="" disabled selected>Choisir une commune...</option>';
        communes.forEach(c => {
            const option = document.createElement('option');
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
        return null;
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

    // Validation
    if (!communeCode || isNaN(start) || isNaN(end) || start > end) {
        alert("Veuillez vérifier les champs.");
        return;
    }

    // Max interval validation
    if (start > 99999 || end > 99999) {
        alert("L'intervalle maximum est 99999.");
        return;
    }

    if (start < 1) {
        alert("L'intervalle minimum est 1.");
        return;
    }

    // PDF mode limit validation (max 500 QR codes for PDF to prevent browser crash)
    if (mode === 'print' && count > 500) {
        alert("Le mode PDF est limité à 500 QR codes maximum pour éviter les problèmes de mémoire.\nVeuillez réduire l'intervalle ou utiliser le mode ZIP pour de plus grands volumes.");
        return;
    }

    progressStatus.textContent = "Vérification des doublons...";
    const conflict = await checkDuplicate(communeCode, start, end);
    if (conflict) {
        alert("Erreur de duplication !\n" + conflict);
        return;
    }

    isGenerating = true;
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Traitement...';
    progressSection.classList.remove('hidden');
    resultSection.classList.add('hidden');
    progressBar.style.width = '0%';
    progressCount.textContent = `0 / ${count}`;
    progressStatus.textContent = "Initialisation...";

    try {
        const cardImages = [];

        for (let i = 0; i < count; i++) {
            const currentId = start + i;
            // Pad interval to 5 digits: 24 -> 00024
            const paddedId = String(currentId).padStart(5, '0');
            const fullId = `${communeCode}${paddedId}`;

            progressStatus.textContent = `Génération de la carte QR: ${fullId}`;
            progressCount.textContent = `${i + 1} / ${count}`;
            progressBar.style.width = `${((i + 1) / count) * 100}%`;

            await new Promise(r => setTimeout(r, 0));

            // Generate the full card image
            const cardData = await renderQRCard(fullId, communeName);
            cardImages.push({
                id: currentId,
                fullId: fullId,
                data: cardData
            });
        }

        progressStatus.textContent = mode === 'individual' ? "Création de l'archive ZIP..." : "Génération du PDF...";
        await new Promise(r => setTimeout(r, 100));

        if (mode === 'individual') {
            await createZip(cardImages, communeName);
        } else {
            await createPdf(cardImages, communeName);
        }

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

// =============================================
// RENDER QR CARD - Full styled card with logos
// =============================================
async function renderQRCard(fullId, communeName) {
    // Card dimensions (similar to original ~55x85mm ratio)
    const cardWidth = 550;
    const cardHeight = 850;

    const canvas = document.createElement('canvas');
    canvas.width = cardWidth;
    canvas.height = cardHeight;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cardWidth, cardHeight);

    // Border
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.roundRect(5, 5, cardWidth - 10, cardHeight - 10, 20);
    ctx.stroke();

    // === HEADER LOGOS ===
    const logoY = 30;
    const logoHeight = 60;

    // Left: Banque Mondiale (or text fallback)
    if (logoCache.banqueMondiale) {
        const img = await loadImage(logoCache.banqueMondiale);
        const ratio = img.width / img.height;
        ctx.drawImage(img, 30, logoY, logoHeight * ratio, logoHeight);
    } else {
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 14px Inter, sans-serif';
        ctx.fillText('BANQUE MONDIALE', 30, logoY + 35);
    }

    // Right: BetPlus (or text fallback)
    if (logoCache.betplus) {
        const img = await loadImage(logoCache.betplus);
        const ratio = img.width / img.height;
        ctx.drawImage(img, cardWidth - 30 - logoHeight * ratio, logoY, logoHeight * ratio, logoHeight);
    }

    ctx.textAlign = 'left';

    // === COMMUNE BANNER ===
    const bannerY = 120;
    const bannerHeight = 50;
    ctx.fillStyle = '#1e3a8a';
    roundRect(ctx, 40, bannerY, cardWidth - 80, bannerHeight, 10);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(communeName.toUpperCase(), cardWidth / 2, bannerY + 33);
    ctx.textAlign = 'left';

    // === PRÉNOM / NOM FIELDS ===
    const fieldY1 = 195;
    const fieldY2 = 280;
    const fieldHeight = 65;

    // Prénom field
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    roundRect(ctx, 40, fieldY1, cardWidth - 80, fieldHeight, 8);
    ctx.stroke();
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillText('Prénom :', 60, fieldY1 + 38);

    // Nom field
    roundRect(ctx, 40, fieldY2, cardWidth - 80, fieldHeight, 8);
    ctx.stroke();
    ctx.fillText('Nom :', 60, fieldY2 + 38);

    // === QR CODE ===
    const qrSize = 280;
    const qrX = (cardWidth - qrSize) / 2;
    const qrY = 380;

    // Generate raw QR code
    const qrBase64 = await generateQRCodeRaw(fullId, qrSize);
    const qrImg = await loadImage(qrBase64);
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

    // Overlay center logo on QR (BetPlus)
    if (logoCache.betplus) {
        const centerLogoSize = 60;
        const centerLogoX = qrX + (qrSize - centerLogoSize) / 2;
        const centerLogoY = qrY + (qrSize - centerLogoSize) / 2;

        // White circle background
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(centerLogoX + centerLogoSize / 2, centerLogoY + centerLogoSize / 2, centerLogoSize / 2 + 5, 0, Math.PI * 2);
        ctx.fill();

        const centerImg = await loadImage(logoCache.betplus);
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerLogoX + centerLogoSize / 2, centerLogoY + centerLogoSize / 2, centerLogoSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(centerImg, centerLogoX, centerLogoY, centerLogoSize, centerLogoSize);
        ctx.restore();
    }

    // === ID TEXT ===
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`ID: ${fullId}`, cardWidth / 2, 710);

    // === FOOTER ===
    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px Inter, sans-serif';
    ctx.fillText('Généré par BETPLUSAUDETAG', cardWidth / 2, 760);

    return canvas.toDataURL('image/png');
}

// Helper: Load image from base64
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Helper: Draw rounded rectangle
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Helper: Generate styled QR code with rounded dots
function generateQRCodeRaw(text, size) {
    return new Promise((resolve, reject) => {
        try {
            const qrCode = new QRCodeStyling({
                width: size,
                height: size,
                data: text,
                dotsOptions: {
                    type: "rounded",  // Rounded dots like the original
                    color: "#000000"
                },
                cornersSquareOptions: {
                    type: "extra-rounded",
                    color: "#000000"
                },
                cornersDotOptions: {
                    type: "dot",
                    color: "#000000"
                },
                backgroundOptions: {
                    color: "#ffffff"
                },
                qrOptions: {
                    errorCorrectionLevel: "H"
                }
            });

            qrCode.getRawData("png").then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve(reader.result);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }).catch(reject);
        } catch (err) {
            reject(err);
        }
    });
}

// Helper: Create ZIP with card images
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

// Helper: Create PDF with card images - A4 Landscape, 8 per page
async function createPdf(images, communeName) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'l',  // Landscape
        unit: 'mm',
        format: 'a4'
    });

    // A4 Landscape: 297 x 210 mm
    const pageWidth = 297;
    const pageHeight = 210;
    const margin = 12;
    const cols = 4;  // 4 columns
    const rows = 2;  // 2 rows = 8 per page
    const cardsPerPage = cols * rows;

    // Card dimensions - keep original ratio (550x850 = 0.647)
    // Target height ~85mm, width = 85 * 0.647 = ~55mm
    const cardWidth = 55;
    const cardHeight = 85;
    const cutMarkLength = 5;  // Length of cutting marks

    // Calculate gaps (spacing for cutting)
    const xGap = (pageWidth - (margin * 2) - (cols * cardWidth)) / (cols - 1);
    const yGap = (pageHeight - (margin * 2) - 10 - (rows * cardHeight));  // -10 for footer

    let x = margin;
    let y = margin;
    let col = 0;
    let currentPage = 1;
    const totalPages = Math.ceil(images.length / cardsPerPage);

    for (let i = 0; i < images.length; i++) {
        if (i > 0 && i % cardsPerPage === 0) {
            addPageFooter(doc, currentPage, totalPages, pageWidth, pageHeight);
            doc.addPage();
            currentPage++;
            col = 0;
            x = margin;
            y = margin;
        }

        // Draw cutting marks at corners
        drawCuttingMarks(doc, x, y, cardWidth, cardHeight, cutMarkLength);

        // Add card image
        doc.addImage(images[i].data, 'PNG', x, y, cardWidth, cardHeight);

        col++;
        x += cardWidth + xGap;
        if (col >= cols) {
            col = 0;
            x = margin;
            y += cardHeight + yGap;
        }
    }

    // Add footer to last page
    addPageFooter(doc, currentPage, totalPages, pageWidth, pageHeight);

    const blob = doc.output('blob');
    currentDownloadUrl = URL.createObjectURL(blob);
    currentDownloadName = `Planche_QR_${communeName}.pdf`;

    setupDownload();
}

// Helper: Draw cutting marks at card corners
function drawCuttingMarks(doc, x, y, width, height, markLength) {
    doc.setDrawColor(150);  // Gray color
    doc.setLineWidth(0.3);

    // Top-left corner
    doc.line(x - markLength, y, x - 1, y);  // Horizontal
    doc.line(x, y - markLength, x, y - 1);  // Vertical

    // Top-right corner
    doc.line(x + width + 1, y, x + width + markLength, y);
    doc.line(x + width, y - markLength, x + width, y - 1);

    // Bottom-left corner
    doc.line(x - markLength, y + height, x - 1, y + height);
    doc.line(x, y + height + 1, x, y + height + markLength);

    // Bottom-right corner
    doc.line(x + width + 1, y + height, x + width + markLength, y + height);
    doc.line(x + width, y + height + 1, x + width, y + height + markLength);
}

// Helper: Add page footer
function addPageFooter(doc, currentPage, totalPages, pageWidth, pageHeight) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Page ${currentPage} / ${totalPages}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
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
