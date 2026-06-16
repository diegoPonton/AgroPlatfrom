import { chromium } from 'playwright'
import { mkdir } from 'fs/promises'
import path from 'path'

const OUT = 'screenshots'
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()

// 1. Login page
await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' })
await page.screenshot({ path: path.join(OUT, '01_login.png'), fullPage: false })
console.log('✅ login')

// 2. Register page
await page.goto('http://localhost:3000/register', { waitUntil: 'networkidle' })
await page.screenshot({ path: path.join(OUT, '02_register.png'), fullPage: false })
console.log('✅ register')

// 3. Register a test user to get into the dashboard
//    (API not running, so we mock the token to skip auth guard and screenshot the shell)
await page.evaluate(() => {
  localStorage.setItem('access_token', 'fake-token-for-screenshot')
})

// 4. Devices list (will show loading/empty since no API)
await page.goto('http://localhost:3000/devices', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: path.join(OUT, '03_devices.png'), fullPage: false })
console.log('✅ devices list')

// 5. Register new device form
await page.goto('http://localhost:3000/devices/new', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(OUT, '04_new_device.png'), fullPage: false })
console.log('✅ new device')

// 6. Firmware page
await page.goto('http://localhost:3000/firmware', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(OUT, '05_firmware.png'), fullPage: false })
console.log('✅ firmware')

await browser.close()
console.log('Done — screenshots in ./screenshots/')
