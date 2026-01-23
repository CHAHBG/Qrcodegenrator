
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
    create_qr_pdf(r"C:\\Users\\ASUS\\Documents\\Procasef_BETPLUS\\QR_code\\Qr_code generator\\WebQRCodeGenerator\\output\\DIMBOLI_70000_70001", r"C:\\Users\\ASUS\\Documents\\Procasef_BETPLUS\\QR_code\\Qr_code generator\\WebQRCodeGenerator\\output\\DIMBOLI_70000_70001\\DIMBOLI_70000_70001.pdf")
            