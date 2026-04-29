const fs = require('fs');
const PDFParser = require('pdf2json');

let pdfParser = new PDFParser(this, 1);

pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError));
pdfParser.on("pdfParser_dataReady", pdfData => {
    let text = pdfParser.getRawTextContent();
    let found = false;
    
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('평택') || lines[i].includes('김제') || lines[i].includes('22')) {
            console.log(`Line ${i}: ${lines[i]}`);
            found = true;
        }
    }
    
    if (!found) {
        console.log("No mention of '평택', '김제', or '22' found in the PDF text.");
    }
});

pdfParser.loadPDF("E:/Warehouse pos/TEMP/gwdata1.pdf");