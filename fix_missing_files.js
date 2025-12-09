/**
 * Compare and Fix Missing PHP Files
 * 
 * This script:
 * 1. Compares code source with source destination
 * 2. Finds PHP files that are missing in destination
 * 3. If not encoded: copies them directly
 * 4. If encoded: adds to list for re-processing
 */

const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    sourceDir: 'C:\\Users\\XXXX\\Desktop\\Code',
    destDir: 'C:\\Users\\XXXX\\Desktop\\Source',
    downloadDir: 'C:\\Users\\XXXX\\Desktop\\temp',
    username: 'username',
    password: 'password',
    loginUrl: 'https://easytoyou.eu/login',
    decoderUrl: 'https://easytoyou.eu/decoder/ic11php74',
    reportFile: 'C:\\Users\\XXXX\\Desktop\\missing_files_report.json',
    delayBetweenFiles: 2000
};

/**
 * Check if a PHP file is ionCube encoded
 */
function isIonCubeEncoded(filePath) {
    try {
        const stat = fs.statSync(filePath);
        const readLen = Math.min(4096, stat.size || 0);
        const buffer = Buffer.alloc(readLen);
        const fd = fs.openSync(filePath, 'r');
        const bytesRead = fs.readSync(fd, buffer, 0, readLen, 0);
        fs.closeSync(fd);

        const content = buffer.slice(0, bytesRead).toString('utf8');
        const lower = content.toLowerCase();
        const binary = buffer.slice(0, bytesRead);

        // Strong signatures
        if (
            lower.includes('ioncube') ||
            content.includes('<?php //0') ||
            content.includes('HR+c')
        ) {
            return true;
        }

        // Heuristic: heavy binary + no common PHP keywords
        const printable = [];
        let nullCount = 0;
        for (const b of binary) {
            if (
                (b >= 32 && b < 127) || // ASCII printable
                b === 9 || b === 10 || b === 13 // tab/lf/cr
            ) {
                printable.push(b);
            }
            if (b === 0) nullCount++;
        }
        const nonPrintableRatio = 1 - printable.length / (binary.length || 1);
        const hasPhpKeywords = /\b(class|function|static|array|return|extends|implements)\b/i.test(content);

        if (nullCount > 0 && nonPrintableRatio > 0.2 && !hasPhpKeywords) {
            return true;
        }
    } catch (err) {
        console.error(`Error reading ${filePath}: ${err.message}`);
    }
    return false;
}
/**
 * Get all PHP files from a directory
 */
function getAllPhpFiles(dir, baseDir = dir) {
    const phpFiles = [];
    
    function walkDir(currentDir) {
        const files = fs.readdirSync(currentDir);
        files.forEach(file => {
            const fullPath = path.join(currentDir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                walkDir(fullPath);
            } else if (file.toLowerCase().endsWith('.php')) {
                const relativePath = path.relative(baseDir, currentDir);
                phpFiles.push({
                    fullPath,
                    relPath: relativePath === '.' ? '' : relativePath,
                    fileName: file,
                    relKey: path.join(relativePath === '.' ? '' : relativePath, file)
                });
            }
        });
    }
    
    walkDir(dir);
    return phpFiles;
}

/**
 * Decode a single file
 */
async function decodeFile(page, file) {
    try {
        await page.goto(CONFIG.decoderUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1000);
        
        await page.waitForSelector('input[type="file"]', { timeout: 10000 });
        
        const fileInput = await page.$('form[enctype="multipart/form-data"] input[type="file"]') 
            || await page.$('input[type="file"]');
        
        if (!fileInput) {
            throw new Error('File input not found');
        }
        
        await fileInput.setInputFiles(file.fullPath);
        console.log(`    Uploaded`);
        
        await page.waitForTimeout(500);
        
        const submitBtn = await page.$('input[value="Decode"]') || await page.$('input[type="submit"]');
        if (!submitBtn) {
            throw new Error('Submit button not found');
        }
        
        await submitBtn.click();
        console.log(`    Submitted`);
        
        await page.waitForSelector('table.table-bordered', { timeout: 120000 });
        await page.waitForTimeout(2000);
        
        const downloadLink = await page.evaluate(() => {
            const table = document.querySelector('table.table-bordered');
            if (table) {
                const links = table.querySelectorAll('a[href*="download"]');
                for (const link of links) {
                    if (link.href.includes('download?id=')) {
                        return link.href;
                    }
                }
            }
            return null;
        });
        
        if (!downloadLink) {
            throw new Error('Download link not found');
        }
        
        console.log(`    Download link found`);
        
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.click(`a[href*="download?id="]`)
        ]);
        
        const tempDownloadPath = path.join(CONFIG.downloadDir, `temp_${Date.now()}_${file.fileName}`);
        await download.saveAs(tempDownloadPath);
        
        const destFolder = file.relPath 
            ? path.join(CONFIG.destDir, file.relPath) 
            : CONFIG.destDir;
        
        if (!fs.existsSync(destFolder)) {
            fs.mkdirSync(destFolder, { recursive: true });
        }
        
        const destFile = path.join(destFolder, file.fileName);
        
        await new Promise(r => setTimeout(r, 500));
        
        if (fs.existsSync(tempDownloadPath)) {
            fs.renameSync(tempDownloadPath, destFile);
            console.log(`    ✓ Decoded and saved`);
            return true;
        } else {
            throw new Error('Downloaded file not found');
        }
        
    } catch (err) {
        console.error(`    ✗ Error: ${err.message}`);
        return false;
    }
}

/**
 * Main function
 */
async function main() {
    console.log('='.repeat(60));
    console.log('Compare and Fix Missing PHP Files');
    console.log('='.repeat(60));
    
    // Get all PHP files from source
    console.log('\n[Step 1] Scanning source directory...');
    const sourceFiles = getAllPhpFiles(CONFIG.sourceDir);
    console.log(`  Found ${sourceFiles.length} PHP files in source`);
    
    // Get all PHP files from destination
    console.log('\n[Step 2] Scanning destination directory...');
    const destFiles = getAllPhpFiles(CONFIG.destDir);
    console.log(`  Found ${destFiles.length} PHP files in destination`);
    
    // Create a set of destination file keys for quick lookup
    const destFileKeys = new Set(destFiles.map(f => f.relKey));
    
    // Find missing files
    console.log('\n[Step 3] Finding missing files...');
    const missingFiles = sourceFiles.filter(f => !destFileKeys.has(f.relKey));
    console.log(`  Missing files: ${missingFiles.length}`);
    
    if (missingFiles.length === 0) {
        console.log('\n  ✓ All files are present in destination!');
        console.log('\n' + '='.repeat(60));
        console.log('No action needed.');
        console.log('='.repeat(60));
        return;
    }
    
    // Analyze missing files
    console.log('\n[Step 4] Analyzing missing files...');
    const plainFiles = [];
    const encodedFiles = [];
    
    for (const file of missingFiles) {
        if (isIonCubeEncoded(file.fullPath)) {
            encodedFiles.push(file);
            console.log(`  [ENCODED] ${file.relKey}`);
        } else {
            plainFiles.push(file);
            console.log(`  [PLAIN] ${file.relKey}`);
        }
    }
    
    console.log(`\n  Plain (not encoded): ${plainFiles.length}`);
    console.log(`  Encoded (need decode): ${encodedFiles.length}`);
    
    // Save report
    const report = {
        timestamp: new Date().toISOString(),
        totalMissing: missingFiles.length,
        plainFiles: plainFiles.map(f => f.relKey),
        encodedFiles: encodedFiles.map(f => f.relKey)
    };
    fs.writeFileSync(CONFIG.reportFile, JSON.stringify(report, null, 2));
    console.log(`\n  Report saved to: ${CONFIG.reportFile}`);
    
    // Copy plain files
    if (plainFiles.length > 0) {
        console.log('\n[Step 5] Copying plain PHP files...');
        let copiedCount = 0;
        
        for (const file of plainFiles) {
            const destFolder = file.relPath 
                ? path.join(CONFIG.destDir, file.relPath) 
                : CONFIG.destDir;
            
            if (!fs.existsSync(destFolder)) {
                fs.mkdirSync(destFolder, { recursive: true });
            }
            
            const destFile = path.join(destFolder, file.fileName);
            fs.copyFileSync(file.fullPath, destFile);
            copiedCount++;
            console.log(`  ✓ Copied: ${file.relKey}`);
        }
        
        console.log(`  Total copied: ${copiedCount}`);
    }
    
    // Decode encoded files
    if (encodedFiles.length > 0) {
        console.log(`\n[Step 6] Decoding ${encodedFiles.length} encoded files...`);
        
        const browser = await firefox.launch({
            headless: false,
            downloadsPath: CONFIG.downloadDir
        });
        
        const context = await browser.newContext({
            acceptDownloads: true
        });
        
        const page = await context.newPage();
        
        try {
            // Login
            console.log('  Logging in...');
            await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle', timeout: 60000 });
            await page.waitForTimeout(2000);
            
            const emailField = await page.$('input[type="text"]');
            if (emailField) await emailField.fill(CONFIG.username);
            
            const passwordField = await page.$('input[name="password"]');
            if (passwordField) await passwordField.fill(CONFIG.password);
            
            const submitBtn = await page.$('input[type="submit"]');
            if (submitBtn) await submitBtn.click();
            
            await page.waitForTimeout(3000);
            console.log('  Login successful!\n');
            
            // Process encoded files
            let successCount = 0;
            let failCount = 0;
            
            for (let i = 0; i < encodedFiles.length; i++) {
                const file = encodedFiles[i];
                console.log(`\n  [${i + 1}/${encodedFiles.length}] ${file.relKey}`);
                
                const success = await decodeFile(page, file);
                
                if (success) {
                    successCount++;
                } else {
                    failCount++;
                }
                
                await page.waitForTimeout(CONFIG.delayBetweenFiles);
            }
            
            console.log('\n' + '='.repeat(60));
            console.log('Processing complete!');
            console.log(`  Plain files copied: ${plainFiles.length}`);
            console.log(`  Encoded files decoded: ${successCount}`);
            console.log(`  Failed: ${failCount}`);
            console.log('='.repeat(60));
            
        } catch (err) {
            console.error(`\nFatal error: ${err.message}`);
        } finally {
            await browser.close();
        }
    } else {
        console.log('\n' + '='.repeat(60));
        console.log('Processing complete!');
        console.log(`  Plain files copied: ${plainFiles.length}`);
        console.log(`  No encoded files to process.`);
        console.log('='.repeat(60));
    }
}

// Run
main().catch(console.error);
