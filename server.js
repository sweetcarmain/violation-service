cat > server.js << 'EOL'
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات CORS
app.use(cors());
app.use(bodyParser.json());

// مسار الصفحة الرئيسية
app.get('/', (req, res) => {
    res.json({ status: 'Service is running' });
});

// مسار الاختبار
app.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'الخدمة تعمل بشكل صحيح',
        serverTime: new Date().toISOString()
    });
});

// مسار الاستعلام عن المخالفات
app.post('/api/violations', async (req, res) => {
    console.log('Received request:', req.body);
    
    try {
        const { civilId } = req.body;
        
        if (!civilId) {
            return res.status(400).json({
                success: false,
                message: 'يرجى تقديم الرقم المدني'
            });
        }
        
        console.log('Processing civil ID:', civilId);
        
        // الحصول على المخالفات من موقع وزارة الداخلية
        const violations = await getViolationsFromMOI(civilId);
        
        console.log('Retrieved violations:', violations.length);
        
        return res.json({
            success: true,
            message: 'تم الاستعلام بنجاح',
            violations: violations
        });
        
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            success: false,
            message: 'حدث خطأ أثناء الاستعلام'
        });
    }
});

// دالة للحصول على المخالفات من موقع وزارة الداخلية
async function getViolationsFromMOI(civilId) {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });
    
    try {
        console.log('Browser launched successfully');
        const page = await browser.newPage();
        
        // تعيين User-Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36');
        
        // تعيين viewport
        await page.setViewport({ width: 1366, height: 768 });
        
        console.log('Navigating to MOI website...');
        // الانتقال إلى صفحة الاستعلام عن المخالفات
        await page.goto('https://www.moi.gov.kw/main/eservices/gdt/violation-enquiry', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        console.log('Page loaded successfully');
        
        // إضافة تأخير قصير
        await page.waitForTimeout(2000);
        
        // التقاط لقطة شاشة للتأكد من التحميل الصحيح
        await page.screenshot({ path: '/tmp/initial-page.png' });
        console.log('Initial screenshot taken');
        
        // إدخال الرقم المدني في الحقل المحدد
        console.log('Entering civil ID...');
        await page.type('#civilId', civilId);
        
        // التقاط لقطة شاشة بعد إدخال الرقم المدني
        await page.screenshot({ path: '/tmp/filled-form.png' });
        console.log('Form filled with civil ID');
        
        // النقر على زر الاستعلام
        console.log('Clicking the enquiry button...');
        await Promise.all([
            page.click('#btnEnquire'),
            // انتظار التنقل أو انتهاء النشاط على الشبكة
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(e => {
                console.log('Navigation may not have occurred:', e.message);
            })
        ]);
        
        console.log('Enquiry submitted');
        
        // إضافة تأخير للتأكد من تحميل النتائج
        await page.waitForTimeout(5000);
        
        // التقاط لقطة شاشة للنتائج
        await page.screenshot({ path: '/tmp/results-page.png' });
        console.log('Results screenshot taken');
        
        // استخراج بيانات المخالفات من الصفحة
        const violations = await page.evaluate(() => {
            console.log('Extracting violation data...');
            const results = [];
            
            // البحث عن الجداول في الصفحة
            const tables = document.querySelectorAll('table');
            console.log(`Found ${tables.length} tables`);
            
            if (tables && tables.length > 0) {
                tables.forEach((table, tableIndex) => {
                    const rows = table.querySelectorAll('tr');
                    console.log(`Table ${tableIndex} has ${rows.length} rows`);
                    
                    // تخطي صف العنوان
                    for (let i = 1; i < rows.length; i++) {
                        const cells = rows[i].querySelectorAll('td');
                        if (cells.length >= 4) {
                            const violation = {};
                            
                            // استخراج البيانات حسب ترتيب الأعمدة
                            // يمكن تعديل هذه المنطقة حسب ترتيب البيانات في جدول النتائج
                            if (cells[0]) violation.id = cells[0].textContent.trim();
                            if (cells[1]) violation.date = cells[1].textContent.trim();
                            if (cells[2]) violation.type = cells[2].textContent.trim();
                            if (cells[3]) violation.amount = cells[3].textContent.trim();
                            if (cells[4]) violation.location = cells[4].textContent.trim();
                            
                            // إضافة المخالفة إلى النتائج
                            results.push(violation);
                        }
                    }
                });
            } else {
                console.log('No tables found, looking for violation data in other elements');
                
                // البحث عن معلومات المخالفات في عناصر أخرى
                const violationElements = document.querySelectorAll('.violation-item, .record, .result-row');
                
                if (violationElements && violationElements.length > 0) {
                    violationElements.forEach(element => {
                        // استخراج البيانات من عناصر النتائج
                        const text = element.textContent.trim();
                        const violation = {
                            text: text
                        };
                        results.push(violation);
                    });
                }
            }
            
            // إذا لم نجد أي بيانات، نتحقق من وجود رسالة "لا توجد مخالفات"
            if (results.length === 0) {
                const pageText = document.body.textContent;
                if (pageText.includes('لا توجد مخالفات') || 
                    pageText.includes('لم يتم العثور على مخالفات') ||
                    pageText.toLowerCase().includes('no violations')) {
                    console.log('No violations found message detected');
                }
            }
            
            return results;
        });
        
        console.log(`Found ${violations.length} violations after extraction`);
        
        // إذا لم نجد أي مخالفات، نرجع مصفوفة فارغة
        if (violations.length === 0) {
            console.log('No violations found, returning empty array');
            return [];
        }
        
        return violations;
    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await browser.close();
        console.log('Browser closed');
    }
}

// تشغيل الخادم
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
EOL

npm install puppeteer express cors body-parser

node server.js
