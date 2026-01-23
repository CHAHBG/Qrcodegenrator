
import pandas as pd
import json
import os

# Path to the excel file (relative to where this script will be run, or absolute)
# The script is in WebQRCodeGenerator, the excel is in the parent folder
EXCEL_PATH = "../ListesCommunesProcasef_URM_BoundouOfficiel.xlsx"
OUTPUT_JSON = "communes.json"

def extract_communes():
    if not os.path.exists(EXCEL_PATH):
        print(f"Error: File not found at {EXCEL_PATH}")
        return

    try:
        df = pd.read_excel(EXCEL_PATH, dtype=str)
        
        # Normalize columns
        df.columns = df.columns.str.strip()
        
        # Find relevant columns
        syscol_col = next((c for c in df.columns if c.lower() == 'syscol_commune'), None)
        commune_col = next((c for c in df.columns if c.lower() == 'commune'), None)
        
        if not syscol_col or not commune_col:
            print("Error: Required columns 'SYSCOL_Commune' and 'Commune' not found.")
            return

        communes = []
        seen_codes = set()
        
        for _, row in df.iterrows():
            code = str(row[syscol_col]).strip()
            # Clean code: digits only, take first 8
            code = ''.join(filter(str.isdigit, code))[:8]
            
            name = str(row[commune_col]).strip().upper()
            
            if code and name and code not in seen_codes:
                communes.append({
                    "code": code,
                    "name": name
                })
                seen_codes.add(code)
                
        # Sort by name
        communes.sort(key=lambda x: x['name'])
        
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(communes, f, indent=2, ensure_ascii=False)
            
        print(f"Successfully extracted {len(communes)} communes to {OUTPUT_JSON}")
        
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    extract_communes()
