import { afterAll, beforeAll, expect, it } from 'vitest';
import { firefox, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

declare global { interface Window { EditorTest: typeof import('./fixtures/textEditorEntry.js'); } }
let display: ChildProcess;
let browser: Browser;
let page: Page;
beforeAll(async () => {
    display = spawn('Xvfb', [':95', '-screen', '0', '800x600x24'], { stdio: 'ignore' });
    await new Promise(resolve => setTimeout(resolve, 700));
    browser = await firefox.launch({ headless: false, env: { ...process.env, DISPLAY: ':95', LIBGL_ALWAYS_SOFTWARE: '1' } });
    page = await browser.newPage();
    await page.route('http://localhost/editor-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('http://localhost/editor-test');
    const bundle = await build({
        entryPoints: [fileURLToPath(new URL('./fixtures/textEditorEntry.ts', import.meta.url))],
        bundle: true, write: false, format: 'iife', globalName: 'EditorTest',
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.EditorTest.start());
    await page.waitForTimeout(150);
    await page.mouse.move(120, 16); await page.mouse.down();
    await page.waitForTimeout(60); await page.mouse.up();
}, 30_000);
afterAll(async () => { await browser?.close(); display?.kill(); });

async function press(key: string): Promise<void> {
    await page.keyboard.down(key); await page.waitForTimeout(60);
    await page.keyboard.up(key); await page.waitForTimeout(60);
}

it('edits with Backspace, Delete, printable characters, navigation, and undo', async () => {
    await page.evaluate(() => { window.EditorTest.editor.SetText('abc'); window.EditorTest.editor.SetCursorPosition(0, 3); });
    await press('Backspace');
    expect(await page.evaluate(() => window.EditorTest.editor.GetText())).toBe('ab\n');
    await page.evaluate(() => window.EditorTest.editor.SetCursorPosition(0, 0));
    await press('Delete');
    expect(await page.evaluate(() => window.EditorTest.editor.GetText())).toBe('b\n');
    await page.keyboard.down('Control'); await press('z'); await page.keyboard.up('Control');
    expect(await page.evaluate(() => window.EditorTest.editor.GetText())).toBe('ab\n');
    await press('End'); await press('x');
    expect(await page.evaluate(() => window.EditorTest.editor.GetText())).toBe('abx\n');
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keypress', { key: 'Delete', code: 'Delete', charCode: 127 })));
    await page.waitForTimeout(60);
    expect(await page.evaluate(() => window.EditorTest.editor.GetText())).toBe('abx\n');
});

it('does not turn modifiers into letters or leave movement keys stuck', async () => {
    await page.keyboard.down('Shift');
    expect(await page.evaluate(() => window.EditorTest.keyDown(83))).toBe(false);
    await page.keyboard.down('w');
    expect(await page.evaluate(() => window.EditorTest.keyDown(87))).toBe(true);
    await page.keyboard.up('Shift'); await page.keyboard.up('w');
    expect(await page.evaluate(() => window.EditorTest.keyDown(87))).toBe(false);
    await page.keyboard.down('Alt');
    expect(await page.evaluate(() => window.EditorTest.keyDown(65))).toBe(false);
    await page.keyboard.up('Alt');
});
