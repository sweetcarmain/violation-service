// تعديل التكوين للعمل مع Render
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات CORS (هام: أضف عنوان موقعك على GoDaddy)
app.use(cors({
    origin: ['https://yourdomain.com', 'http://yourdomain.com'],
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(bodyParser.json());

// طريقة للتأكد من أن الخدمة تعمل
app.get('/', (req, res) => {
    res.json({ status: 'Service is running' });
});

// طريقة الاستعلام عن المخالفات
app.post('/api/violations', async (req, res) => {
    try {
        const { plateNumber, civilId } = req.body;

        // التحقق من المدخلات
        if (!plateNumber || !civilId) {
            return res.status(400).json({
                success: false,
                message: 'يرجى تقديم رقم اللوحة والرقم المدني'
            });
        }

        // الحصول على معلومات المخالفات من موقع وزارة الداخلية
        const violations = await getViolationsFromMOI(plateNumber, civilId);

        return res.json({
            success: true,
            message: 'تم الاستعلام بنجاح',
            violations: violations
        });

    } catch (error) {
        console.error('Error fetching violations:', error);
        return res.status(500).json({
            success: false,
            message: 'حدث خطأ أثناء الاستعلام. يرجى المحاولة مرة أخرى.'
        });
    }
});

// دالة تستخدم Puppeteer للتفاعل مع موقع وزارة الداخلية
async function getViolationsFromMOI(plateNumber, civilId) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-features=IsolateOrigins',
            '--disable-site-isolation-trials'
        ]
    });

    try {
        const page = await browser.newPage();
        
        // تعيين User-Agent لتجنب الكشف
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36');
        
        // تعيين viewport
        await page.setViewport({ width: 1366, height: 768 });

        // الانتقال إلى صفحة الاستعلام عن المخالفات
        await page.goto('https://www.moi.gov.kw/main/eservices/gdt/violation-enquiry', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        console.log('Page loaded successfully');

        // إضافة تأخير قصير للتأكد من تحميل الصفحة بالكامل
        await page.waitForTimeout(2000);

        // ملء نموذج الاستعلام (يجب ضبط أسماء الحقول بناءً على الموقع الفعلي)
        // الحقول الفعلية قد تختلف، لذلك ستحتاج لفحص الموقع والتأكد من الأسماء الصحيحة
        await page.type('#plateNumber', plateNumber);
        await page.type('#civilId', civilId);

        console.log('Form filled successfully');

        // نقر على زر الاستعلام
        await Promise.all([
            page.click('#submitButton'), // قد يختلف معرف الزر
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        ]);

        console.log('Form submitted successfully');

        // إضافة تأخير قصير للتأكد من تحميل النتائج
        await page.waitForTimeout(2000);

        // التقاط لقطة شاشة للتصحيح (يمكن إزالتها لاحقًا)
        await page.screenshot({ path: '/tmp/debug-screenshot.png' });

        // استخراج بيانات المخالفات من الصفحة
        const violations = await page.evaluate(() => {
            // هذا الكود سيعتمد على بنية HTML في موقع وزارة الداخلية
            // ويحتاج للتعديل بناءً على الهيكل الفعلي للصفحة
            const results = [];
            
            // مثال: قد تحتاج إلى تغيير هذه المحددات بناءً على هيكل الصفحة الفعلي
            const violationRows = document.querySelectorAll('.violation-row'); // تغيير هذا للفئة الصحيحة
            
            if (violationRows && violationRows.length > 0) {
                violationRows.forEach(row => {
                    results.push({
                        id: row.querySelector('.violation-id')?.textContent.trim(),
                        date: row.querySelector('.violation-date')?.textContent.trim(),
                        time: row.querySelector('.violation-time')?.textContent.trim(),
                        type: row.querySelector('.violation-type')?.textContent.trim(),
                        amount: row.querySelector('.violation-amount')?.textContent.trim(),
                        location: row.querySelector('.violation-location')?.textContent.trim()
                    });
                });
            } else {
                // إذا لم نجد النتائج بالمحددات المتوقعة، سنحاول البحث عن أي جدول في الصفحة
                console.log('No specific violation rows found, trying general table extraction');
                
                // البحث عن أي جداول في الصفحة
                const tables = document.querySelectorAll('table');
                tables.forEach((table, tableIndex) => {
                    const rows = table.querySelectorAll('tr');
                    
                    // تخطي صف العنوان
                    for (let i = 1; i < rows.length; i++) {
                        const cells = rows[i].querySelectorAll('td');
                        if (cells.length >= 4) {
                            results.push({
                                id: cells[0]?.textContent.trim() || `قيمة ${tableIndex}-${i}-1`,
                                date: cells[1]?.textContent.trim() || 'غير متوفر',
                                type: cells[2]?.textContent.trim() || 'غير متوفر',
                                amount: cells[3]?.textContent.trim() || 'غير متوفر',
                                location: cells[4]?.textContent.trim() || 'غير متوفر',
                                time: cells[5]?.textContent.trim() || 'غير متوفر'
                            });
                        }
                    }
                });
            }
            
            return results;
        });

        console.log(`Found ${violations.length} violations`);
        return violations;
    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// بدء تشغيل الخادم
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
