const fs = require('fs');
const pdf = require('pdf-parse');

let dataBuffer = fs.readFileSync('E:/Warehouse pos/TEMP/gwdata1.pdf');

pdf(dataBuffer).then(function(data) {
    const text = data.text;
    
    // Find occurrences of 평택 or 김제 and their surrounding context
    const lines = text.split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('평택') || lines[i].includes('김제') || lines[i].includes('22')) {
            console.log(`Line ${i}: ${lines[i]}`);
            found = true;
        }
    }
    
    if (!found) {
        console.log("No mention of '평택', '김제', or '22' found in the PDF text.");
    }
}).catch(function(error) {
    console.error("Error parsing PDF:", error);
});