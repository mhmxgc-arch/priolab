# Priolab

מערכת ניתוח רווח והפסד לאקספרס טכנולוגיות. היא תומכת בניתוח שנתי ובהשוואת תקופות, טעינת XLSX, ניהול משתמשים והרשאות, אימות סיסמה וקוד TOTP (Google Authenticator), ורשימת כתובות IP מורשות.

## ניהול קבצים

מנהל המערכת יכול לפתוח ״ניהול קבצים״ מהתפריט הראשי. הרשימה כוללת את שם הקובץ, תיאור הדוח, התקופה, מספר השורות ומועד העדכון, עם חיפוש וסינון לפי שנה ומצב תצוגה. הסתרה שומרת את הנתונים ומוציאה את הדוח מהניתוח ומההשוואות; החזרה לתצוגה מבטלת אותה. מחיקה לאחר אישור מסירה את הדוח ואת הנתונים שנקלטו ממנו. טעינה מחדש לאותה תקופה ותיאור מחליפה את הדוח ומחזירה אותו לתצוגה. המערכת שומרת את נתוני הדוחות שנקלטו מה־Excel; קובץ ה־Excel המקורי אינו נשמר.

## גרסאות

הגרסה מוגדרת ב־`lib/version.ts`, מוצגת במסך הכניסה ומתועדת ב־`CHANGELOG.md`. בכל שחרור מעדכנים את שני הקבצים.

## אחסון ואבטחה

הדוחות נשמרים ב־D1. נתונים כספיים, סיסמאות ומפתחות אימות אינם נכללים במאגר GitHub הציבורי. בסביבת Sites מוגדר סוד `APP_ENCRYPTION_KEY` (מפתח AES בן 32 בתים בקידוד base64). באתר Sites הפרטי בעל האתר יוצר את המשתמש הראשון. בפריסת APP-01 משתמש ה־admin נוצר מתוך השרת בלבד, לפי DEPLOY.md בשורש המאגר. בכניסה הראשונה הוא מחליף את הסיסמה הראשונית לסיסמה מורכבת בת 8 תווים לפחות, ואז מחבר Google Authenticator ומאמת קוד. אין גישה לדוחות לפני השלמת שני השלבים. הגבלת IP מופעלת בהגדרות לאחר הוספת הכתובת הנוכחית.

האימות הפנימי נוסף להגנת הגישה של אתר Sites הפרטי. הדוחות מוגשים רק דרך API מוגן session. רשימת ה־IP נאכפת בבקשות API.

## פיתוח

`npm install` · `npm run db:generate` · `npm run build`. שינויי סכימה חדשים נרשמים במיגרציות Drizzle חדשות. קובצי דוחות אישיים אינם נכללים בקוד המקור.


## Company boundaries (v3)

Analysis is always scoped to an authenticated company. System administrators can create companies and assign regular users under Settings. Administrators have system-wide company access; editors and viewers require an explicit company membership and retain their existing role. Removing membership immediately denies subsequent API reads and writes.

Every report belongs to a company and a module. Report identity is `(company_id, module_key, tax_year, from_month, to_month, description)`. Lists, saves, replacements, visibility and deletion must all filter by company; report IDs alone never authorize access. The iframe receives an explicit company ID and is remounted when switching companies, clearing all prior company data and filters. There is no cross-company comparison.

`lib/tenancy.ts` is the shared company authorization and module registry. `pnl` is available; `balance` is reserved for future development and is not an enabled uploader. New modules must use companyAccess on every operation, their own validation and versioned migrations. Global identity, password/TOTP, IP policies and company administration remain system settings; business reports and future analysis records always belong to a company.

Migration 0003 explicitly deletes **all pre-v3 test reports**, as authorized by the owner on 2026-10-01. It runs once, preserves users, security settings and sessions, and initializes an empty Xpress company. This deletion applies when the deployment runs the migration, not merely when GitHub is updated. New report uploads must select a company. Do not apply this migration to a database with production reports without a backup and a reviewed migration plan.
