/**
 *  IonCube Decoder Script - Enhanced Version
 * 
 * Features:
 * - Proper download handling
 * - Browser crash recovery
 * - Progress tracking
 * - Resume capability
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
    progressFile: 'C:\\Users\\XXXX\\Desktop\\decode_progress.json',
    maxRetries: 3,
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
 * Create directory structure
 */
function createDirectoryStructure(sourceDir, destDir) {
    console.log('\n[Step 1] Creating directory structure...');
    
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    
    function walkDir(dir) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                const relativePath = path.relative(sourceDir, fullPath);
                const destPath = path.join(destDir, relativePath);
                
                if (!fs.existsSync(destPath)) {
                    fs.mkdirSync(destPath, { recursive: true });
                }
                
                walkDir(fullPath);
            }
        });
    }
    
    walkDir(sourceDir);
}

/**
 * Copy non-PHP files
 */
function copyNonPhpFiles(sourceDir, destDir) {
    console.log('\n[Step 2] Copying non-PHP files...');
    let count = 0;
    
    function walkDir(dir) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                walkDir(fullPath);
            } else if (!file.toLowerCase().endsWith('.php')) {
                const relativePath = path.relative(sourceDir, fullPath);
                const destPath = path.join(destDir, relativePath);
                const destFolder = path.dirname(destPath);
                
                if (!fs.existsSync(destFolder)) {
                    fs.mkdirSync(destFolder, { recursive: true });
                }
                
                fs.copyFileSync(fullPath, destPath);
                count++;
            }
        });
    }
    
    walkDir(sourceDir);
    console.log(`  Total: ${count} files`);
}

/**
 * Get all PHP files
 */
function getPhpFiles(sourceDir) {
    console.log('\n[Step 3] Scanning PHP files...');
    const phpFiles = [];
    
    function walkDir(dir) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                walkDir(fullPath);
            } else if (file.toLowerCase().endsWith('.php')) {
                const relativePath = path.relative(sourceDir, dir);
                phpFiles.push({
                    fullPath,
                    relPath: relativePath === '.' ? '' : relativePath,
                    fileName: file
                });
            }
        });
    }
    
    walkDir(sourceDir);
    console.log(`  Found ${phpFiles.length} PHP files`);
    return phpFiles;
}

/**
 * Load progress
 */
function loadProgress() {
    if (fs.existsSync(CONFIG.progressFile)) {
        try {
            const data = fs.readFileSync(CONFIG.progressFile, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.log('  Could not load progress, starting fresh');
        }
    }
    return { processed: [], failed: [] };
}

/**
 * Save progress
 */
function saveProgress(progress) {
    try {
        fs.writeFileSync(CONFIG.progressFile, JSON.stringify(progress, null, 2));
    } catch (err) {
        console.error('  Error saving progress:', err.message);
    }
}

/**
 * Decode a single file
 */
async function decodeFile(page, file, progress) {
    const fileKey = `${file.relPath}/${file.fileName}`.replace(/^\//, '');
    
    // Check if already processed
    if (progress.processed.includes(fileKey)) {
        console.log(`  Already processed, skipping`);
        return true;
    }
    
    try {
        // Navigate to decoder page
        await page.goto(CONFIG.decoderUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1000);
        
        // Wait for file input
        await page.waitForSelector('input[type="file"]', { timeout: 10000 });
        
        // Upload file - the input has name like "100612[]"
        const fileInput = await page.$('form[enctype="multipart/form-data"] input[type="file"]') 
            || await page.$('input[type="file"]');
        
        if (!fileInput) {
            throw new Error('File input not found');
        }
        
        // Get file input name for debugging
        const inputName = await fileInput.getAttribute('name');
        console.log(`  File input found: name=${inputName}`);
        
        await fileInput.setInputFiles(file.fullPath);
        console.log(`  File uploaded`);
        
        // Submit form - the button has value="Decode" and class="btn btn-primary"
        await page.waitForTimeout(500);
        
        const submitSelectors = [
            'input[value="Decode"]',
            'input[name="submit"]',
            'form[enctype="multipart/form-data"] input[type="submit"]',
            'input.btn-primary[type="submit"]',
            'input[type="submit"]'
        ];
        
        let submitBtn = null;
        for (const selector of submitSelectors) {
            submitBtn = await page.$(selector);
            if (submitBtn) {
                const value = await submitBtn.getAttribute('value');
                console.log(`  Submit button: ${selector} (value=${value})`);
                break;
            }
        }
        
        if (!submitBtn) {
            throw new Error('Submit button not found');
        }
        
        await submitBtn.click();
        console.log(`  Form submitted`);
        
        // Wait for table with results
        await page.waitForSelector('table.table-bordered', { timeout: 120000 });
        await page.waitForTimeout(2000);
        
        // Find download link in table
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
            throw new Error('Download link not found in table');
        }
        
        console.log(`  Download link: ${downloadLink}`);
        
        // Download file by clicking the link directly
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.click(`a[href*="download?id="]`)
        ]);
        
        // Save file with original name
        const tempDownloadPath = path.join(CONFIG.downloadDir, `temp_${Date.now()}_${file.fileName}`);
        await download.saveAs(tempDownloadPath);
        
        console.log(`  File downloaded`);
        
        // Move to final destination
        const destFolder = file.relPath 
            ? path.join(CONFIG.destDir, file.relPath) 
            : CONFIG.destDir;
        
        if (!fs.existsSync(destFolder)) {
            fs.mkdirSync(destFolder, { recursive: true });
        }
        
        const destFile = path.join(destFolder, file.fileName);
        
        // Wait a bit and move file
        await new Promise(r => setTimeout(r, 500));
        
        if (fs.existsSync(tempDownloadPath)) {
            fs.renameSync(tempDownloadPath, destFile);
            console.log(`  ✓ Saved to: ${destFile}`);
            
            // Update progress
            progress.processed.push(fileKey);
            saveProgress(progress);
            
            return true;
        } else {
            throw new Error('Downloaded file not found');
        }
        
    } catch (err) {
        console.error(`  ✗ Error: ${err.message}`);
        return false;
    }
}

/**
 * Main function
 */
async function main() {
    console.log('='.repeat(60));
    console.log('IonCube Decoder - Enhanced Version');
    console.log('='.repeat(60));
    
    // Create directory structure
    createDirectoryStructure(CONFIG.sourceDir, CONFIG.destDir);
    
    // Copy non-PHP files
    copyNonPhpFiles(CONFIG.sourceDir, CONFIG.destDir);
    
    // Get all PHP files
    const phpFiles = getPhpFiles(CONFIG.sourceDir);
    
    // Separate encoded and non-encoded files
    const encodedFiles = [];
    const nonEncodedFiles = [];
    
    console.log('\n[Step 4] Analyzing PHP files...');
    for (const file of phpFiles) {
        if (isIonCubeEncoded(file.fullPath)) {
            encodedFiles.push(file);
        } else {
            nonEncodedFiles.push(file);
        }
    }
    
    console.log(`  Encoded: ${encodedFiles.length}`);
    console.log(`  Plain: ${nonEncodedFiles.length}`);
    
    // Copy non-encoded PHP files
    console.log(`\n[Step 5] Copying plain PHP files...`);
    for (const file of nonEncodedFiles) {
        const destFolder = file.relPath 
            ? path.join(CONFIG.destDir, file.relPath) 
            : CONFIG.destDir;
        
        if (!fs.existsSync(destFolder)) {
            fs.mkdirSync(destFolder, { recursive: true });
        }
        
        const destFile = path.join(destFolder, file.fileName);
        fs.copyFileSync(file.fullPath, destFile);
    }
    console.log(`  Done`);
    
    // Process encoded files
    if (encodedFiles.length === 0) {
        console.log('\n[Step 6] No encoded files to process.');
        console.log('\n' + '='.repeat(60));
        console.log('Processing complete!');
        console.log('='.repeat(60));
        return;
    }
    
    console.log(`\n[Step 6] Decoding ${encodedFiles.length} ionCube files...`);
    
    // Load progress
    const progress = loadProgress();
    console.log(`  Previously processed: ${progress.processed.length}`);
    
    // Filter already processed files
    const remainingFiles = encodedFiles.filter(file => {
        const fileKey = `${file.relPath}/${file.fileName}`.replace(/^\//, '');
        return !progress.processed.includes(fileKey);
    });
    
    console.log(`  Remaining: ${remainingFiles.length}`);
    
    if (remainingFiles.length === 0) {
        console.log('\n  All files already processed!');
        console.log('\n' + '='.repeat(60));
        console.log('Processing complete!');
        console.log('='.repeat(60));
        return;
    }
    
    // Launch browser
    console.log('\n  Launching Firefox...');
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
        
        // Fill login form - try multiple selectors
        const emailSelectors = [
            'input[name="email"]',
            'input[name="username"]', 
            'input[name="user"]',
            'input[name="login"]',
            'input[type="email"]',
            'input[type="text"]'
        ];
        
        for (const selector of emailSelectors) {
            const field = await page.$(selector);
            if (field) {
                await field.fill(CONFIG.username);
                console.log(`  Username field found: ${selector}`);
                break;
            }
        }
        
        const passwordSelectors = [
            'input[name="password"]',
            'input[name="pass"]',
            'input[type="password"]'
        ];
        
        for (const selector of passwordSelectors) {
            const field = await page.$(selector);
            if (field) {
                await field.fill(CONFIG.password);
                console.log(`  Password field found: ${selector}`);
                break;
            }
        }
        
        // Try multiple submit button selectors
        const submitSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Login")',
            'button:has-text("login")',
            'input[value="Login"]',
            'input[value="login"]',
            '.btn-primary',
            'button.btn'
        ];
        
        let clicked = false;
        for (const selector of submitSelectors) {
            try {
                const btn = await page.$(selector);
                if (btn) {
                    await btn.click();
                    console.log(`  Submit button found: ${selector}`);
                    clicked = true;
                    break;
                }
            } catch (e) {
                // Try next selector
            }
        }
        
        if (!clicked) {
            // Try pressing Enter on password field
            await page.keyboard.press('Enter');
            console.log('  Submitted with Enter key');
        }
        
        await page.waitForTimeout(3000);
        await page.waitForLoadState('networkidle').catch(() => {});
        
        console.log('  Login successful!\n');
        
        // Process each file
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < remainingFiles.length; i++) {
            const file = remainingFiles[i];
            const totalProcessed = progress.processed.length + i + 1;
            
            console.log(`\n  [${totalProcessed}/${encodedFiles.length}] ${file.fileName}`);
            
            const success = await decodeFile(page, file, progress);
            
            if (success) {
                successCount++;
            } else {
                failCount++;
                const fileKey = `${file.relPath}/${file.fileName}`.replace(/^\//, '');
                if (!progress.failed.includes(fileKey)) {
                    progress.failed.push(fileKey);
                    saveProgress(progress);
                }
            }
            
            // Small delay between files
            await page.waitForTimeout(CONFIG.delayBetweenFiles);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('Processing complete!');
        console.log(`  Successfully decoded: ${successCount}`);
        console.log(`  Failed: ${failCount}`);
        console.log(`  Total processed: ${progress.processed.length}`);
        console.log('='.repeat(60));
        
    } catch (err) {
        console.error(`\nFatal error: ${err.message}`);
        console.log('\nProgress has been saved. Run the script again to resume.');
    } finally {
        await browser.close();
    }
}

// Run
main().catch(console.error);
