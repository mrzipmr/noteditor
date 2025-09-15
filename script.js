'use strict';

let allBlocks = [];
let vocabularyList = [];
let blockCounter = 0;
let undoStack = [];

const editor = document.getElementById('textEditor');
const preview = document.getElementById('preview');

// --- Color Generation ---
const stringToSha1RgbColor = async (str) => { const data = new TextEncoder().encode(str.toLowerCase().trim()); const hashBuffer = await window.crypto.subtle.digest('SHA-1', data); const hashArray = new Uint8Array(hashBuffer); const toHex = (c) => c.toString(16).padStart(2, '0'); return `#${toHex(hashArray[0])}${toHex(hashArray[1])}${toHex(hashArray[2])}`; };
const mixHexColor = (hex, mixHex, weight) => { const c1 = parseInt(hex.slice(1), 16), c2 = parseInt(mixHex.slice(1), 16); const r = Math.round(((c1 >> 16) * (1 - weight)) + ((c2 >> 16) * weight)); const g = Math.round((((c1 >> 8) & 0x00FF) * (1 - weight)) + (((c2 >> 8) & 0x00FF) * weight)); const b = Math.round(((c1 & 0x0000FF) * (1 - weight)) + ((c2 & 0x0000FF) * weight)); const toHex = (c) => c.toString(16).padStart(2, '0'); return `#${toHex(r)}${toHex(g)}${toHex(b)}`; };

// --- Modals ---
const showModal = (content) => { const overlay = document.createElement('div'); overlay.className = 'modal-overlay'; overlay.innerHTML = content; document.body.appendChild(overlay); setTimeout(() => overlay.classList.add('show'), 10); const closeModal = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 300); document.removeEventListener('keydown', keydownHandler); }; const keydownHandler = (e) => { if (e.key === 'Escape') closeModal(); }; overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); }); overlay.querySelectorAll('.modal-cancel-btn, .modal-close-btn').forEach(btn => btn.addEventListener('click', closeModal)); document.addEventListener('keydown', keydownHandler); return { overlay, closeModal }; };
const showEditModal = (title, initialContent, onSave) => { const { overlay, closeModal } = showModal(`<div class="modal-dialog"><h2>${title}</h2><textarea id="modal-textarea" style="width:100%; height: 200px; font-family:var(--font-mono); padding:10px; border:1px solid #ccc; border-radius:5px;">${initialContent}</textarea><div class="modal-buttons"><button class="modal-cancel-btn">Отмена</button><button class="modal-save-btn">Сохранить</button></div></div>`); overlay.querySelector('.modal-save-btn').addEventListener('click', () => { onSave(overlay.querySelector('#modal-textarea').value); closeModal(); }); overlay.querySelector('#modal-textarea').focus(); };
const showHtmlModal = (title, htmlContent) => { showModal(`<div class="modal-dialog"><h2>${title}</h2><div class="modal-content-display">${htmlContent}</div><div class="modal-buttons"><button class="modal-close-btn">Закрыть</button></div></div>`); };

// --- Helpers ---
const getSelectedText = () => ({ text: editor.value.substring(editor.selectionStart, editor.selectionEnd), start: editor.selectionStart, end: editor.selectionEnd });
const applyFormatting = (tag) => { const { text, start, end } = getSelectedText(); if (!text) return; const before = editor.value.substring(0, start), after = editor.value.substring(end); const tagStart = `<${tag}>`, tagEnd = `</${tag}>`; const isFormatted = before.endsWith(tagStart) && after.startsWith(tagEnd); editor.setRangeText( isFormatted ? text : tagStart + text + tagEnd, isFormatted ? start - tagStart.length : start, isFormatted ? end + tagEnd.length : end, 'select'); editor.focus(); autoSaveToLocalStorage(); };
const insertAtCursor = (text) => { editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'select'); editor.focus(); autoSaveToLocalStorage(); };
const highlightElement = (id) => { setTimeout(() => { const el = document.getElementById(id); if (el) { el.classList.add('highlight'); el.onanimationend = () => el.classList.remove('highlight'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 50); };

// --- Dictionary URLs ---
const encodeWordForUrl = (word) => encodeURIComponent(word.trim().toLowerCase().replace(/\s+/g, '-'));
const getCollinsUrl = (word) => `https://www.collinsdictionary.com/dictionary/english/${encodeWordForUrl(word)}`;
const getCambridgeUrl = (word) => `https://dictionary.cambridge.org/dictionary/english/${encodeWordForUrl(word)}`;
const getOxfordUrl = (word) => `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeWordForUrl(word)}`;
const getGoogleTranslateUrl = (word) => `https://translate.google.com/?sl=en&tl=ru&text=${encodeURIComponent(word.trim())}`;
const getLongmanUrl = (word) => `https://www.ldoceonline.com/dictionary/${encodeWordForUrl(word)}`;
const getMacmillanUrl = (word) => `https://www.macmillandictionary.com/dictionary/british/${encodeWordForUrl(word)}`;

// --- Table Parser (v5 - rowspan) ---
const generateTableHTML = (tableContent) => {
    let content = tableContent.trim(); let caption = '';
    if (content.startsWith('*')) { const firstNewlineIndex = content.indexOf('\n'); const firstLine = firstNewlineIndex === -1 ? content : content.substring(0, firstNewlineIndex); caption = firstLine.substring(1).trim(); content = (firstNewlineIndex === -1) ? '' : content.substring(firstNewlineIndex + 1).trim(); }
    const lines = content.split('\n'); if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) return '';
    let headers = []; let dataLines = []; let numColumns = 0;
    const firstContentLine = lines.find(l => l.trim() !== '');
    const isHeaderRow = firstContentLine && firstContentLine.trim().startsWith('*') && firstContentLine.trim().endsWith('*');
    if (isHeaderRow) { headers = firstContentLine.trim().slice(1, -1).split('*').map(h => h.trim()); dataLines = lines.slice(lines.indexOf(firstContentLine) + 1); } else { dataLines = lines; }
    const firstDataRowForCols = dataLines.find(l => l.trim() !== '' && !l.trim().startsWith('*'));
    numColumns = headers.length > 0 ? headers.length : (firstDataRowForCols ? firstDataRowForCols.split('*').length : 0);
    if (numColumns === 0) return '';
    const matrix = []; let lastAnchorRow = null;
    for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i]; const trimmedLine = line.trim();
        if (trimmedLine === '' || trimmedLine.startsWith('*')) continue;
        const prevLine = (i > 0) ? dataLines[i - 1].trim() : ''; const cells = line.split('*').map(c => c.trim());
        if (prevLine.startsWith('*') && lastAnchorRow) {
            const markerContent = prevLine.substring(1).trim(); const columnsToConnect = markerContent ? markerContent.match(/\d/g)?.map(Number) : [];
            const newPartialRow = []; let partialRowHasContent = false;
            for (let j = 0; j < numColumns; j++) {
                const colIndex = j + 1; const shouldConnect = columnsToConnect.length === 0 || columnsToConnect.includes(colIndex);
                if (shouldConnect) { if (cells[j]) { lastAnchorRow[j].content = (lastAnchorRow[j].content ? lastAnchorRow[j].content + '<br>' : '') + cells[j]; lastAnchorRow[j].rowspan++; }
                } else { if (cells[j]) { newPartialRow.push({ content: cells[j], rowspan: 1 }); partialRowHasContent = true; } else { newPartialRow.push(null); } }
            }
            if (partialRowHasContent) {
                const finalPartialRow = [];
                for(let j=0; j<numColumns; j++) { const colIndex = j+1; const shouldConnect = columnsToConnect.length === 0 || columnsToConnect.includes(colIndex); if(!shouldConnect){ finalPartialRow.push(newPartialRow.shift() || {content:'', rowspan:1}); } else { finalPartialRow.push(null); } }
                matrix.push(finalPartialRow);
            }
        } else { const newRow = cells.slice(0, numColumns).map(c => ({ content: c, rowspan: 1 })); while(newRow.length < numColumns) newRow.push({content:'', rowspan:1}); matrix.push(newRow); lastAnchorRow = newRow; }
    }
    let tableHTML = '<div class="content-table-wrapper"><table class="content-table">';
    if (caption) tableHTML += `<caption class="content-table-caption">${caption}</caption>`;
    if (headers.length > 0) tableHTML += `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
    tableHTML += '<tbody>';
    for (const row of matrix) { let rowHtml = '<tr>'; for (const cell of row) { if (cell !== null) { const rowspanAttr = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''; rowHtml += `<td${rowspanAttr}>${cell.content}</td>`; } } rowHtml += '</tr>'; tableHTML += rowHtml; }
    tableHTML += '</tbody></table></div>';
    return tableHTML;
};
const parseAndReplaceTables = (content) => { return content.replace(/<(.*?)>/gs, (match, tableContent) => generateTableHTML(tableContent)); };

// --- Hierarchical Block Parsers & Generators (v3 - FINAL) ---
const parseSimpleContent = async (simpleContent, isDialogueContext) => { let html = ''; let currentParagraphLines = []; let currentExampleLines = []; let dialogueSpeakerCounter = 0; const flushParagraph = async () => { if (currentParagraphLines.length === 0) return; if (isDialogueContext) { for (const line of currentParagraphLines) { if (line.includes(':') && !line.trim().startsWith('*')) { const parts = line.split(/:\s*(.*)/s); const speaker = parts[0].trim(); let replica = (parts[1] || '').trim().replace(/\\/g, '<br>'); const side = (dialogueSpeakerCounter % 2 === 0) ? 'left' : 'right'; const baseColor = await stringToSha1RgbColor(speaker); const bgColor = mixHexColor(baseColor, '#FFFFFF', 0.85); const borderColor = mixHexColor(baseColor, '#FFFFFF', 0.65); const speakerColor = mixHexColor(baseColor, '#000000', 0.6); html += `<div class="dialogue-line ${side}" style="background-color:${bgColor}; border-color:${borderColor};"><strong class="dialogue-speaker" style="color:${speakerColor};">${speaker}</strong>${replica}</div>`; dialogueSpeakerCounter++; } else { html += `<p>${line}</p>`; } } } else { html += `<p>${currentParagraphLines.join('<br>')}</p>`; } currentParagraphLines = []; }; const flushExamples = () => { if (currentExampleLines.length > 0) { html += `<div class="internal-example-group">${currentExampleLines.map(line => `<div>${line.substring(2).trim()}</div>`).join('')}</div>`; currentExampleLines = []; } }; for (const line of simpleContent.split('\n')) { const trimmed = line.trim(); if(trimmed.startsWith('<div class="content-table-wrapper">')) { await flushParagraph(); flushExamples(); html += line; continue; } if (trimmed.startsWith('**')) { await flushParagraph(); currentExampleLines.push(line); } else if (trimmed.startsWith('*')) { await flushParagraph(); flushExamples(); html += `<div class="internal-block-header">${trimmed.substring(1).trim()}</div>`; } else if (trimmed === '') { await flushParagraph(); flushExamples(); } else { flushExamples(); currentParagraphLines.push(line); } } await flushParagraph(); flushExamples(); return html; };
const parseInternalBlockContent = async (content, isDialogueContext) => {
    const contentWithTables = parseAndReplaceTables(content);
    const mainChunks = contentWithTables.split(/\n\s*_\s*\n/g); const finalHtmlChunks = [];
    for (const chunk of mainChunks) {
        if (chunk.includes('\n/\n')) {
            const columns = chunk.split(/\n\/\n/g); let responsiveHtml = '<div class="responsive-content-group">';
            for (let i = 0; i < columns.length; i++) { responsiveHtml += `<div class="responsive-content-item">${await parseSimpleContent(columns[i], isDialogueContext)}</div>`; if (i < columns.length - 1) responsiveHtml += '<span class="responsive-pipe">|</span>'; }
            responsiveHtml += '</div>'; finalHtmlChunks.push(responsiveHtml);
        } else { finalHtmlChunks.push(await parseSimpleContent(chunk, isDialogueContext)); }
    }
    return finalHtmlChunks.join('<div class="internal-block-separator"></div>');
};
const createRuleHtml = async (content) => `<div class="rule-block">${await parseInternalBlockContent(content, false)}</div>`;
const createExampleHtml = async (content) => `<div class="example-block">${await parseInternalBlockContent(content, false)}</div>`;
const createDialogueHtml = async (content) => `<div class="dialogue-block">${await parseInternalBlockContent(content, true)}</div>`;
const createSeparatorHtml = () => `<div class="separator-wrapper"><hr class="compact-separator"></div>`;
const createMarkupHeaderHtml = (content) => `<div class="markup-header-block">${content}</div>`;
const createCenteredHtml = (content) => { const lines = content.split('\n').filter(Boolean); const firstLine = lines.length > 0 ? `<b>${lines[0]}</b>` : ''; const restLines = lines.slice(1).length > 0 ? `<i>${lines.slice(1).join('<br>')}</i>` : ''; return `<div class="centered-block">${firstLine}${firstLine && restLines ? '<br>' : ''}${restLines}</div>`; };
const getHtmlForBlock = async (block) => { switch(block.type) { case 'rule': return await createRuleHtml(block.content); case 'dialogue': return await createDialogueHtml(block.content); case 'example': return await createExampleHtml(block.content); case 'centered': return createCenteredHtml(block.content); case 'separator': return createSeparatorHtml(); case 'markup-header': return createMarkupHeaderHtml(block.content); default: return ''; } };

// --- Block Management ---
const saveStateForUndo = () => { undoStack.push({ allBlocks: JSON.parse(JSON.stringify(allBlocks)), vocabularyList: JSON.parse(JSON.stringify(vocabularyList)), blockCounter, editorText: editor.value }); if (undoStack.length > 30) undoStack.shift(); };
const createBlock = async (type, content = '') => { saveStateForUndo(); const id = `${type}-${++blockCounter}`; allBlocks.push({ id, type, content, order: (allBlocks.length ? Math.max(...allBlocks.map(b => b.order)) : 0) + 1 }); await renderPreview(); highlightElement(id); autoSaveToLocalStorage(); };
const handleBlockCreation = (type, requiresSelection = true) => { const { text } = getSelectedText(); if (requiresSelection && !text.trim() && !confirm(`Создать пустой блок "${type}"?`)) return; createBlock(type, text); };

// --- File & Export Operations ---
const getFullPreviewHtml = async (title) => {
    const styles = document.getElementById('styles-template').innerHTML;
    let contentHtml = ''; for (const block of allBlocks.sort((a,b) => a.order - b.order)) { contentHtml += await getHtmlForBlock(block); }
    if (vocabularyList.length > 0) { const vocabLinks = (word) => `<a href="${getCollinsUrl(word)}" target="_blank" class="dict-btn collins">Collins</a><a href="${getCambridgeUrl(word)}" target="_blank" class="dict-btn cambridge">Cambridge</a><a href="${getOxfordUrl(word)}" target="_blank" class="dict-btn oxford">Oxford</a><a href="${getGoogleTranslateUrl(word)}" target="_blank" class="dict-btn google">Google</a><a href="${getLongmanUrl(word)}" target="_blank" class="dict-btn longman">Longman</a><a href="${getMacmillanUrl(word)}" target="_blank" class="dict-btn macmillan">Macmillan</a>`; contentHtml += `<div class="vocabulary-master-block"><h2>📖 Словарь</h2>${vocabularyList.map(item => `<div class="vocab-item"><div class="vocab-item-word"><span class="main-word">${item.word}</span><div class="dict-buttons">${vocabLinks(item.word)}</div></div></div>`).join('')}</div>`; }
    const titleBlock = title ? `<div class="html-title-block"><h1>${title}</h1></div>` : '';
    return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title || 'Notes'}</title>${styles}</head><body><div class="container">${titleBlock}${contentHtml}</div></body></html>`;
};
const saveDataToFile = () => { const data = { allBlocks, vocabularyList, blockCounter, editorText: editor.value }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'english_editor_data.json'; a.click(); a.remove(); };
const loadDataFromFile = () => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.onchange = async e => { if (!e.target.files[0] || !confirm('Загрузка файла перезапишет текущую работу. Продолжить?')) return; try { const data = JSON.parse(await e.target.files[0].text()); if (data.allBlocks && data.vocabularyList) { saveStateForUndo(); allBlocks = data.allBlocks; vocabularyList = data.vocabularyList; blockCounter = data.blockCounter || 0; editor.value = data.editorText || ''; await renderPreview(); autoSaveToLocalStorage(); alert('Данные загружены!'); } else alert('Неверный формат файла.'); } catch { alert('Ошибка чтения файла.'); } }; input.click(); };
const saveAsHTML = async () => { const title = prompt("Заголовок для HTML-файла:", "Мои заметки"); if (!title) return; const fullHtml = await getFullPreviewHtml(title); const blob = new Blob([fullHtml], { type: 'text/html' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${title.replace(/\s/g, '_')}.html`; a.click(); a.remove(); };
const saveAsPDF = async () => { const title = prompt("Заголовок для PDF-файла:", "Мои заметки"); if (!title) return; const contentHtml = await getFullPreviewHtml(title); const tempFrame = document.createElement('iframe'); tempFrame.style.cssText = 'position: absolute; left: -9999px; top: 0; width: 1200px; border: 0;'; document.body.appendChild(tempFrame); const frameDoc = tempFrame.contentWindow.document; frameDoc.open(); frameDoc.write(contentHtml); frameDoc.close(); alert("Начинается генерация PDF. Пожалуйста, подождите..."); tempFrame.onload = () => { html2canvas(frameDoc.body.querySelector('.container'), { scale: 2, useCORS: true, logging: false }).then(canvas => { const imgData = canvas.toDataURL('image/png'); const { jsPDF } = window.jspdf; const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' }); const pdfWidth = pdf.internal.pageSize.getWidth(); const imgHeight = canvas.height * pdfWidth / canvas.width; let heightLeft = imgHeight; let position = 0; pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight); heightLeft -= pdf.internal.pageSize.getHeight(); while (heightLeft > 0) { position = heightLeft - imgHeight; pdf.addPage(); pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight); heightLeft -= pdf.internal.pageSize.getHeight(); } pdf.save(`${title.replace(/\s/g, '_')}.pdf`); tempFrame.remove(); }).catch(err => { console.error("PDF generation failed:", err); alert("Ошибка генерации PDF."); tempFrame.remove(); }); }; };

// --- Main Render Function ---
const renderPreview = async () => {
    allBlocks.sort((a, b) => a.order - b.order); let finalHtml = '<h3>📋 Предварительный просмотр</h3>';
    for (const [index, block] of allBlocks.entries()) {
        const blockHtml = await getHtmlForBlock(block); const wrapper = document.createElement('div'); wrapper.innerHTML = blockHtml;
        const blockElement = wrapper.firstElementChild;
        if(blockElement){
            blockElement.id = block.id; blockElement.dataset.type = block.type;
            blockElement.draggable = true; // Make sure blocks are draggable
            blockElement.innerHTML += `<div class="block-controls"><span class="block-number" title="Нажмите для перемещения">#${index + 1}</span>${block.type !== 'separator' ? `<button class="edit-btn" title="Редактировать">✏️</button>` : ''}<button class="delete-btn" title="Удалить">×</button></div>`;
            finalHtml += blockElement.outerHTML;
        }
    }
    if (vocabularyList.length > 0) { const vocabButtons = (word) => `<button class="dict-btn collins" data-url="${getCollinsUrl(word)}">Collins</button><button class="dict-btn cambridge" data-url="${getCambridgeUrl(word)}">Cambridge</button><button class="dict-btn oxford" data-url="${getOxfordUrl(word)}">Oxford</button><button class="dict-btn google" data-url="${getGoogleTranslateUrl(word)}">Google</button><button class="dict-btn longman" data-url="${getLongmanUrl(word)}">Longman</button><button class="dict-btn macmillan" data-url="${getMacmillanUrl(word)}">Macmillan</button>`; finalHtml += `<div class="vocabulary-master-block"><h2>📖 Словарь</h2>${vocabularyList.map(item => `<div class="vocab-item" id="${item.id}" data-type="vocab"><div class="block-controls"><button class="delete-btn" title="Удалить">×</button></div><div class="vocab-item-word"><span class="main-word">${item.word}</span><div class="dict-buttons">${vocabButtons(item.word)}</div></div></div>`).join('')}</div>`; }
    preview.innerHTML = finalHtml;
};

// --- Local Storage & Undo ---
const autoSaveToLocalStorage = () => localStorage.setItem('englishEditorAutoSaveV3.1', JSON.stringify({ allBlocks, vocabularyList, blockCounter, editorText: editor.value }));
const loadFromLocalStorage = () => { const savedData = localStorage.getItem('englishEditorAutoSaveV3.1'); if (savedData) { const data = JSON.parse(savedData); allBlocks = data.allBlocks || []; vocabularyList = data.vocabularyList || []; blockCounter = data.blockCounter || 0; editor.value = data.editorText || ''; } };
const undoLastAction = async () => { if (!undoStack.length) return alert('Больше нет действий для отмены.'); const state = undoStack.pop(); allBlocks = state.allBlocks; vocabularyList = state.vocabularyList; blockCounter = state.blockCounter; editor.value = state.editorText; await renderPreview(); autoSaveToLocalStorage(); };

// --- Drag and Drop Handlers ---
let draggedEl = null;
const handleDragStart = (e) => {
    draggedEl = e.target.closest('[data-type]');
    if (!draggedEl) return;
    e.dataTransfer.setData('text/plain', draggedEl.id);
    setTimeout(() => draggedEl.classList.add('dragging'), 0);
};
const handleDragOver = (e) => {
    e.preventDefault();
    const target = e.target.closest('[data-type]');
    if (target && target !== draggedEl) {
        document.querySelectorAll('.drop-target-top').forEach(el => el.classList.remove('drop-target-top'));
        target.classList.add('drop-target-top');
    }
};
const handleDragLeave = (e) => { e.target.closest('[data-type]')?.classList.remove('drop-target-top'); };
const handleDrop = async (e) => {
    e.preventDefault();
    document.querySelectorAll('.drop-target-top').forEach(el => el.classList.remove('drop-target-top'));
    const targetEl = e.target.closest('[data-type]');
    if (!targetEl || !draggedEl || targetEl === draggedEl) return;
    
    const sourceId = draggedEl.id;
    const targetId = targetEl.id;

    saveStateForUndo();
    const sortedBlocks = [...allBlocks].sort((a,b) => a.order - b.order);
    const sourceIndex = sortedBlocks.findIndex(b => b.id === sourceId);
    const targetIndex = sortedBlocks.findIndex(b => b.id === targetId);
    
    const [movedBlock] = sortedBlocks.splice(sourceIndex, 1);
    sortedBlocks.splice(targetIndex, 0, movedBlock);

    sortedBlocks.forEach((block, index) => block.order = index);
    allBlocks = sortedBlocks;

    await renderPreview();
    highlightElement(sourceId);
    autoSaveToLocalStorage();
};
const handleDragEnd = () => { if (draggedEl) { draggedEl.classList.remove('dragging'); draggedEl = null; } };

// --- FULLY UPDATED GUIDE CONTENT ---
const GUIDE_HTML_CONTENT_RU = `<h3>🚀 Добро пожаловать в Редактор текстов по английским правилам!</h3><p>Это подробное руководство поможет вам эффективно использовать все функции для создания и оформления заметок по английскому языку.</p><h4>📝 1. Основное форматирование текста</h4><p>Эти кнопки позволяют форматировать выделенный текст непосредственно в <b>Редакторе</b> (левая панель). Нажмите повторно, чтобы снять форматирование.</p><ul><li><button class="format-btn"><b>B</b></button> (Жирный): Делает выделенный текст <b>жирным</b>. (Горячая клавиша: <code>Ctrl + B</code>)</li><li><button class="format-btn"><i>I</i></button> (Курсив): Делает выделенный текст <i>курсивом</i>. (Горячая клавиша: <code>Ctrl + I</code>)</li><li><button class="format-btn"><s>S</s></button> (Зачеркнутый): Добавляет <s>зачеркивание</s> к выделенному тексту. (Горячая клавиша: <code>Ctrl + Shift + S</code>)</li></ul><h4>🧱 2. Создание основных блоков</h4><ul><li><button class="tool-btn rule-btn">📚</button> <b>Блок правил</b></li><li><button class="tool-btn dialogue-btn">💬</button> <b>Блок диалога</b></li><li><button class="tool-btn example-btn">💡</button> <b>Блок примеров</b></li><li><button class="tool-btn center-btn">T</button> <b>Центрированный текст</b></li><li><button class="tool-btn line-btn">➖</button> <b>Линия-разделитель</b></li><li><button class="tool-btn header-block-btn">⭐</button> <b>Основной заголовок</b></li></ul><h4>⚙️ 3. Внутреннее форматирование контента в блоках</h4><ul><li><code>* Заголовок</code> для создания внутреннего заголовка.</li><li><code>** Пример</code> для создания строки-примера.</li><li><code>_</code> на отдельной строке для горизонтального разделителя.</li><li><code>/</code> на отдельной строке для создания адаптивных колонок.</li></ul><h5>3.5. Форматирование диалога</h5><p>Внутри <b>Блока диалога</b>, используйте формат <code>Имя: Реплика</code> для автоматического оформления.</p><h4>📖 4. Управление словарным запасом</h4><p>Выделите слово и нажмите 📖, чтобы добавить его в словарь с быстрыми ссылками на онлайн-словари.</p><h4>🗄️ 5. Операции с файлами и экспорт</h4><p>Сохраняйте и загружайте свою работу в формате <code>.json</code>. Экспортируйте готовый результат в <code>.html</code> или <code>.pdf</code>.</p><h4>⚙️ 6. Общие функции</h4><ul><li><b>Автосохранение</b> в браузере.</li><li><b>Отмена (Ctrl+Z)</b>.</li><li><b>Управление блоками:</b> Нажмите ✏️ для редактирования, ❌ для удаления.</li><li><b>Перемещение блоков:</b> Нажмите на номер <code>#N</code>, чтобы ввести новую позицию, или просто <b>перетащите блок</b> в нужное место.</li></ul>`;

// --- Initialization ---
const initializeEditor = async () => {
    loadFromLocalStorage();
    const buttons = {
        'boldBtn': () => applyFormatting('b'), 'italicBtn': () => applyFormatting('i'), 'strikeBtn': () => applyFormatting('s'),
        'ruleBtn': () => handleBlockCreation('rule'), 'dialogueBtn': () => handleBlockCreation('dialogue'), 'exampleBtn': () => handleBlockCreation('example'), 'centerBlockBtn': () => handleBlockCreation('centered'),
        'tableBtn': () => insertAtCursor('<*Пример асимметричной таблицы\n*Колонка 1*Колонка 2*Колонка 3*\n1*2*3\n* 1\n4*5*6\n* 1\n7*8*9\n>'),
        'internalHeaderBtn': () => insertAtCursor('* '), 'internalExampleBtn': () => insertAtCursor('** '), 'internalSeparatorBtn': () => insertAtCursor('\n_\n'), 'responsiveColumnBtn': () => insertAtCursor('\n/\n'),
        'lineBtn': () => createBlock('separator', ''), 'headerBlockBtn': () => handleBlockCreation('markup-header'),
        'addVocabWordBtn': () => { const { text } = getSelectedText(); if (!text.trim()) return alert('Выделите слово для добавления.'); saveStateForUndo(); text.split('\n').filter(Boolean).forEach(word => { const trimmedWord = word.trim(); if (!vocabularyList.some(item => item.word.toLowerCase() === trimmedWord.toLowerCase())) { vocabularyList.push({ id: `vocab-${++blockCounter}`, word: trimmedWord }); } }); renderPreview(); autoSaveToLocalStorage(); },
        'saveFileBtn': saveDataToFile, 'loadFileBtn': loadDataFromFile,
        'previewInNewTabBtn': async () => { const title = prompt("Заголовок для предпросмотра:", "Live Preview"); if(title === null) return; const html = await getFullPreviewHtml(title); const newTab = window.open(); newTab.document.write(html); newTab.document.close(); }, 
        'saveHtmlBtn': saveAsHTML, 'savePdfBtn': saveAsPDF,
        'clearBtn': () => { if (confirm('Очистить всё? Действие необратимо.')) { saveStateForUndo(); allBlocks = []; vocabularyList = []; editor.value = ''; renderPreview(); autoSaveToLocalStorage(); } },
        'guideBtn': () => showHtmlModal('❓ Руководство', GUIDE_HTML_CONTENT_RU),
    };
    for (const [id, func] of Object.entries(buttons)) { const btn = document.getElementById(id); if(btn) btn.addEventListener('click', func); }
    
    editor.addEventListener('keydown', (e) => { if (document.querySelector('.modal-overlay.show')) return; if (e.ctrlKey || e.metaKey) { const key = e.key.toLowerCase(); if (['b', 'i'].includes(key) || (key === 's' && e.shiftKey)) { e.preventDefault(); applyFormatting(key === 's' ? 's' : key); } else if (key === 'z') { e.preventDefault(); undoLastAction(); } } });
    editor.addEventListener('input', () => { autoSaveToLocalStorage(); renderPreview(); });

    preview.addEventListener('click', async e => {
        const target = e.target; const blockEl = target.closest('[data-type]');
        if (!blockEl) return; const id = blockEl.id;
        if (target.closest('.delete-btn')) { if (confirm('Удалить этот блок?')) { saveStateForUndo(); if (blockEl.dataset.type === 'vocab') vocabularyList = vocabularyList.filter(v => v.id !== id); else allBlocks = allBlocks.filter(b => b.id !== id); await renderPreview(); autoSaveToLocalStorage(); }
        } else if (target.closest('.edit-btn')) { const block = allBlocks.find(b => b.id === id); if(block) showEditModal('Редактировать блок', block.content, newContent => { saveStateForUndo(); block.content = newContent; renderPreview().then(() => highlightElement(id)); autoSaveToLocalStorage(); });
        } else if (target.closest('.dict-btn')) { window.open(target.dataset.url, '_blank');
        } else if (target.closest('.block-number')) { const sortedBlocks = [...allBlocks].sort((a, b) => a.order - b.order); const currentIndex = sortedBlocks.findIndex(b => b.id === id); const newPositionStr = prompt(`Переместить блок #${currentIndex + 1}. Введите новую позицию (от 1 до ${sortedBlocks.length}):`, currentIndex + 1); if (newPositionStr === null) return; const newPosition = parseInt(newPositionStr, 10); if (isNaN(newPosition) || newPosition < 1 || newPosition > sortedBlocks.length) return alert('Неверный номер.'); const targetIndex = newPosition - 1; if (targetIndex === currentIndex) return; saveStateForUndo(); const [movedBlock] = sortedBlocks.splice(currentIndex, 1); sortedBlocks.splice(targetIndex, 0, movedBlock); sortedBlocks.forEach((b, index) => b.order = index); allBlocks = sortedBlocks; await renderPreview(); highlightElement(id); autoSaveToLocalStorage(); }
    });

    // Add Drag and Drop Listeners
    preview.addEventListener('dragstart', handleDragStart);
    preview.addEventListener('dragover', handleDragOver);
    preview.addEventListener('dragleave', handleDragLeave);
    preview.addEventListener('drop', handleDrop);
    preview.addEventListener('dragend', handleDragEnd);

    await renderPreview();
};

document.addEventListener('DOMContentLoaded', initializeEditor);
