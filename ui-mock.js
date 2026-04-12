// ui-mock.js
// 用於填充 Evernote-like 介面的模擬測試資料

const mockNotebooks = [
  { id: 'nb-1', title: 'A 建案 - 青埔高鐵', count: 5 },
  { id: 'nb-2', title: 'B 建案 - A7 重劃區', count: 2 },
  { id: 'nb-3', title: '新竹老家翻修', count: 8 },
  { id: 'nb-4', title: '信貸評估資料', count: 1 }
];

const mockDocuments = {
  'nb-1': [
    { id: 'doc-1', title: '國泰銀行 房貸專案優惠.pdf', date: '2026/04/10', type: 'pdf' },
    { id: 'doc-2', title: '格局平面圖_A棟.png', date: '2026/04/11', type: 'image' },
    { id: 'doc-3', title: '代銷合約草案.pdf', date: '2026/04/12', type: 'pdf' },
    { id: 'doc-4', title: '建材表清單.pdf', date: '2026/04/12', type: 'pdf' },
    { id: 'doc-5', title: '交屋注意事項.txt', date: '2026/04/12', type: 'text' }
  ],
  'nb-2': [
    { id: 'doc-6', title: '公設比分析表.pdf', date: '2026/03/15', type: 'pdf' },
    { id: 'doc-7', title: '周邊嫌惡設施調查.txt', date: '2026/03/16', type: 'text' }
  ],
  'nb-3': [
    { id: 'doc-8', title: '裝潢預算表.pdf', date: '2026/02/01', type: 'pdf' },
    { id: 'doc-9', title: '統包商報價單_v2.pdf', date: '2026/02/02', type: 'pdf' }
    // ... just 2 for preview
  ],
  'nb-4': [
    { id: 'doc-10', title: '台新信貸利率試算.pdf', date: '2026/01/10', type: 'pdf' }
  ]
};

document.addEventListener('DOMContentLoaded', () => {
  const foldersList = document.getElementById('folders-list');
  const docsList = document.getElementById('docs-list');
  const viewerPane = document.getElementById('viewer-content');

  // Render Notebooks
  function renderNotebooks() {
    foldersList.innerHTML = '';
    mockNotebooks.forEach((nb, index) => {
      const li = document.createElement('li');
      li.className = `folder-item ${index === 0 ? 'active' : ''}`;
      li.dataset.id = nb.id;
      
      li.innerHTML = `
        <div class="folder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><path d="M22 6l-10 7L2 6"></path></svg>
        </div>
        <div class="folder-title">${nb.title}</div>
        <div class="folder-badge">${nb.count}</div>
      `;
      
      li.addEventListener('click', () => {
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        renderDocuments(nb.id);
      });
      foldersList.appendChild(li);
    });
    // Default open first
    if (mockNotebooks.length > 0) renderDocuments(mockNotebooks[0].id);
  }

  // Render Documents
  function renderDocuments(notebookId) {
    docsList.innerHTML = '';
    const docs = mockDocuments[notebookId] || [];
    
    if (docs.length === 0) {
      docsList.innerHTML = '<div class="empty-state">此目錄下沒有文件</div>';
      return;
    }

    docs.forEach((doc, index) => {
      const li = document.createElement('li');
      li.className = `doc-item ${index === 0 ? 'active' : ''}`;
      li.dataset.id = doc.id;
      
      li.innerHTML = `
        <div class="doc-icon type-${doc.type}">
          📄
        </div>
        <div class="doc-info">
          <div class="doc-title">${doc.title}</div>
          <div class="doc-date">${doc.date}</div>
        </div>
      `;
      
      li.addEventListener('click', () => {
        document.querySelectorAll('.doc-item').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        renderViewer(doc);
      });
      docsList.appendChild(li);
    });

    // Default open first
    if (docs.length > 0) renderViewer(docs[0]);
    else viewerPane.innerHTML = '<div class="empty-viewer">左側選擇文件以供預覽</div>';
  }

  // Render Viewer Pane (Mock)
  function renderViewer(doc) {
    viewerPane.innerHTML = `
      <div class="mock-pdf-viewer">
        <div class="mock-pdf-header">
          <h3>${doc.title}</h3>
          <span class="mock-pdf-badge">${doc.type.toUpperCase()}</span>
        </div>
        <div class="mock-pdf-body">
          <div class="mock-page">
            <div class="mock-line" style="width: 80%"></div>
            <div class="mock-line" style="width: 90%"></div>
            <div class="mock-line" style="width: 70%"></div>
            <br/>
            <div class="mock-line" style="width: 60%"></div>
            <div class="mock-line" style="width: 85%"></div>
            <br/>
            <div class="mock-watermark">預覽文件</div>
          </div>
        </div>
      </div>
    `;
  }

  renderNotebooks();
});
