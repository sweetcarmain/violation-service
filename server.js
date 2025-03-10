// تعديل التكوين للعمل مع Render
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات CORS (هام: أضف عنوان موقعك على GoDaddy)
app.use(cors({
    origin: '*', // يسمح بالوصول من أي مصدر، يمكنك تغييره لاحقًا ليكون أكثر أمانًا
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(bodyParser.json());

// طريقة للتأكد من أن الخدمة تعمل
app.get('/', (req, res) => {
    res.json({ status: 'Service is running' });
});

// طريقة اختبار بدون استخدام Puppeteer
app.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'الخدمة تعمل بشكل صحيح',
        serverTime: new Date().toISOString()
    });
});

// طريقة الاستعلام عن المخالفات
app.post('/api/violations', async (req, res) => {
    try {
        console.log('Received request:', req.body);
        const { plateNumber, civilId } = req.body;

        // التحقق من المدخلات
        if (!plateNumber || !civilId) {
            return res.status(400).json({
                success: false,
                message: 'يرجى تقديم رقم اللوحة والرقم المدني'
            });
        }

        console.log(`Processing request for plate: ${plateNumber}, civil ID: ${civilId}`);

        // الحصول على معلومات المخالفات من موقع وزارة الداخلية
        const violations = await getViolationsFromMOI(plateNumber, civilId);

        console.log(`Found ${violations.length} violations`);

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
    console.log('Launching browser...');
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
        console.log('Browser launched successfully');
        const page = await browser.newPage();
        
        // تعيين User-Agent لتجنب الكشف
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

        // إضافة تأخير قصير للتأكد من تحميل الصفحة بالكامل
        await page.waitForTimeout(2000);

        // التقاط لقطة شاشة للتأكد من التحميل الصحيح
        await page.screenshot({ path: '/tmp/initial-page.png' });
        console.log('Initial screenshot taken');

        // البحث عن عناصر النموذج - تحتاج إلى تكييف هذه المحددات بناءً على هيكل الصفحة الفعلي
        const formElements = await page.evaluate(() => {
            // تحديد جميع حقول الإدخال في الصفحة
            const inputs = Array.from(document.querySelectorAll('input'));
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
            
            // تسجيل المعلومات عن كل حقل
            return {
                inputs: inputs.map(input => ({
                    id: input.id,
                    name: input.name,
                    type: input.type,
                    placeholder: input.placeholder
                })),
                buttons: buttons.map(button => ({
                    id: button.id,
                    text: button.innerText || button.value,
                    type: button.type
                }))
            };
        });
        
        console.log('Form elements found:', JSON.stringify(formElements));

        // استخدام المعلومات المكتشفة لتحديد حقول الإدخال المناسبة
        // هذه مجرد اقتراحات وقد تحتاج إلى تعديلها بناءً على هيكل الصفحة الفعلي
        
        // البحث عن حقل رقم اللوحة (قد يحتوي على كلمة "plate" أو "لوحة" في المعرف أو النص التوضيحي)
        let plateField = formElements.inputs.find(input => 
            (input.id && input.id.toLowerCase().includes('plate')) || 
            (input.name && input.name.toLowerCase().includes('plate')) ||
            (input.placeholder && input.placeholder.includes('لوحة'))
        );
        
        // البحث عن حقل الرقم المدني (قد يحتوي على كلمة "civil" أو "مدني" في المعرف أو النص التوضيحي)
        let civilIdField = formElements.inputs.find(input => 
            (input.id && input.id.toLowerCase().includes('civil')) || 
            (input.name && input.name.toLowerCase().includes('civil')) ||
            (input.placeholder && input.placeholder.includes('مدني'))
        );
        
        // البحث عن زر الإرسال
        let submitButton = formElements.buttons.find(button => 
            (button.text && (button.text.includes('بحث') || button.text.includes('استعلام'))) ||
            (button.id && (button.id.toLowerCase().includes('search') || button.id.toLowerCase().includes('submit')))
        );

        console.log('Selected plate field:', plateField);
        console.log('Selected civil ID field:', civilIdField);
        console.log('Selected submit button:', submitButton);

        // محاولة ملء النموذج باستخدام أسماء الحقول أو المعرفات المكتشفة
        if (plateField) {
            if (plateField.id) {
                await page.type(`#${plateField.id}`, plateNumber);
            } else if (plateField.name) {
                await page.type(`[name="${plateField.name}"]`, plateNumber);
            }
        } else {
            // إذا لم يتم العثور على الحقل المحدد، حاول استخدام محددات عامة
            // استخدم أول حقل إدخال من النوع نص
            console.log('Plate field not found, trying generic selectors');
            await page.type('input[type="text"]:nth-of-type(1)', plateNumber);
        }
        
        if (civilIdField) {
            if (civilIdField.id) {
                await page.type(`#${civilIdField.id}`, civilId);
            } else if (civilIdField.name) {
                await page.type(`[name="${civilIdField.name}"]`, civilId);
            }
        } else {
            // استخدم ثاني حقل إدخال من النوع نص
            console.log('Civil ID field not found, trying generic selectors');
            await page.type('input[type="text"]:nth-of-type(2)', civilId);
        }

        console.log('Form filled with data');

        // التقاط لقطة شاشة بعد ملء النموذج
        await page.screenshot({ path: '/tmp/filled-form.png' });
        console.log('Form screenshot taken');

        // نقر على زر الإرسال
        if (submitButton && submitButton.id) {
            await Promise.all([
                page.click(`#${submitButton.id}`),
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
            ]);
        } else {
            console.log('Submit button not found by ID, trying generic selectors');
            // محاولة النقر على أول زر في النموذج
            await Promise.all([
                page.click('button[type="submit"], input[type="submit"]'),
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log('Navigation timeout or no navigation occurred:', e.message)),
            ]);
        }

        console.log('Form submitted');

        // إضافة تأخير قصير للتأكد من تحميل النتائج
        await page.waitForTimeout(3000);

        // التقاط لقطة شاشة للنتائج
        await page.screenshot({ path: '/tmp/results-page.png' });
        console.log('Results screenshot taken');

        // استخراج بيانات المخالفات من الصفحة
        const violations = await page.evaluate(() => {
            console.log('Extracting violation data...');
            const results = [];
            
            // محاولة العثور على جداول في الصفحة
            const tables = document.querySelectorAll('table');
            console.log(`Found ${tables.length} tables`);
            
            if (tables && tables.length > 0) {
                tables.forEach((table, tableIndex) => {
                    // تخطي جداول العنوان أو الجداول الأخرى غير ذات الصلة
                    const rows = table.querySelectorAll('tr');
                    console.log(`Table ${tableIndex} has ${rows.length} rows`);
                    
                    // تخطي صف العنوان
                    for (let i = 1; i < rows.length; i++) {
                        const cells = rows[i].querySelectorAll('td');
                        if (cells.length >= 4) {
                            const violation = {};
                            
                            // تحديد البيانات بناءً على ترتيب الأعمدة في الجدول
                            // قد تحتاج إلى تعديل هذا بناءً على هيكل الجدول الفعلي
                            for (let j = 0; j < cells.length; j++) {
                                const cellText = cells[j].textContent.trim();
                                
                                // محاولة تحديد نوع البيانات بناءً على المحتوى
                                if (/^\d+\/\d+\/\d+$/.test(cellText)) {
                                    violation.date = cellText;
                                } else if (/^\d+:\d+$/.test(cellText)) {
                                    violation.time = cellText;
                                } else if (/^\d+(\.\d+)?$/.test(cellText)) {
                                    // إذا كان النص يحتوي على أرقام فقط مع إمكانية وجود نقطة عشرية، فقد يكون المبلغ
                                    violation.amount = cellText;
                                } else if (cellText.length > 10 && !violation.type) {
                                    // إذا كان النص طويلاً، فقد يكون وصف المخالفة
                                    violation.type = cellText;
                                } else if (!violation.id && /^\d+$/.test(cellText)) {
                                    // إذا كان النص يحتوي على أرقام فقط، فقد يكون رقم المخالفة
                                    violation.id = cellText;
                                } else if (!violation.location) {
                                    // خلاف ذلك، قد يكون الموقع
                                    violation.location = cellText;
                                }
                            }
                            
                            // إضافة المخالفة إلى النتائج إذا كانت تحتوي على معلومات كافية
                            if (violation.id || violation.date || violation.type) {
                                results.push(violation);
                            }
                        }
                    }
                });
            } else {
                console.log('No tables found, searching for violation data in other elements');
                
                // البحث عن عناصر div قد تحتوي على معلومات المخالفات
                const violationDivs = document.querySelectorAll('.violation, .result-item, .record');
                
                if (violationDivs && violationDivs.length > 0) {
                    violationDivs.forEach(div => {
                        const violation = {};
                        
                        // محاولة استخراج البيانات من النص
                        const text = div.textContent.trim();
                        
                        // استخراج التاريخ (بتنسيق مثل 12/34/5678)
                        const dateMatch = text.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
                        if (dateMatch) {
                            violation.date = dateMatch[0];
                        }
                        
                        // استخراج الوقت (بتنسيق مثل 12:34)
                        const timeMatch = text.match(/\d{1,2}:\d{2}/);
                        if (timeMatch) {
                            violation.time = timeMatch[0];
                        }
                        
                        // استخراج المبلغ (رقم متبوع بـ "د.ك" أو "KD")
                        const amountMatch = text.match(/(\d+(\.\d+)?)(\s*)(د\.ك|KD)/i);
                        if (amountMatch) {
                            violation.amount = amountMatch[1];
                        }
                        
                        // إضافة المخالفة إلى النتائج إذا تم العثور على أي معلومات
                        if (Object.keys(violation).length > 0) {
                            results.push(violation);
                        }
                    });
                }
            }
            
            // إذا لم نجد أي مخالفات بالطرق السابقة، نبحث عن أي نص قد يشير إلى نتائج
            if (results.length === 0) {
                // التحقق مما إذا كانت هناك رسالة "لا توجد مخالفات"
                const noViolationsText = document.body.textContent;
                if (noViolationsText.includes('لا توجد مخالفات') || 
                    noViolationsText.includes('لم يتم العثور على مخالفات') ||
                    noViolationsText.toLowerCase().includes('no violations') ||
                    noViolationsText.toLowerCase().includes('no records found')) {
                    console.log('Found "no violations" message');
                    // لا نضيف شيئًا لأنه لا توجد مخالفات
                } else {
                    console.log('No structured violation data found');
                }
            }
            
            return results;
        });

        console.log(`Found ${violations.length} violations after extraction`);
        return violations;
    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await browser.close();
        console.log('Browser closed');
    }
}

// للاختبار فقط: إرجاع مخالفات وهمية إذا كان هناك مشكلة في الاتصال
function getFakeViolations() {
    return [
        {
            id: '10' + Math.floor(Math.random() * 10000),
            date: '15/02/2025',
            time: '14:30',
            type: 'تجاوز السرعة المقررة',
            amount: '20',
            location: 'طريق الدائري السادس'
        },
        {
            id: '10' + Math.floor(Math.random() * 10000),
            date: '10/01/2025',
            time: '09:15',
            type: 'وقوف في مكان ممنوع',
            amount: '10',
            location: 'شارع سالم المبارك - السالمية'
        }
    ];
}

// بدء تشغيل الخادم
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
