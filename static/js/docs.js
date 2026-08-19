// Docs editor page logic

const Docs = {
    pages: [],
    activePage: null,
    unsaved: false,

    async init() {
        await this.loadPages();
        this.bindEvents();
    },

    bindEvents() {
        // New page
        document.getElementById('btn-new-doc').addEventListener('click', () => this.createPage());

        // Save
        document.getElementById('btn-save-doc').addEventListener('click', () => this.savePage());

        // Delete
        document.getElementById('btn-delete-doc').addEventListener('click', () => this.deletePage());

        // Title input
        document.getElementById('doc-title-input').addEventListener('input', () => {
            this.unsaved = true;
        });

        // Editor body changes
        document.getElementById('editor-body').addEventListener('input', () => {
            this.unsaved = true;
        });

        // Toolbar buttons
        document.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const command = btn.dataset.command;
                const value = btn.dataset.value || null;
                document.execCommand(command, false, value);
                document.getElementById('editor-body').focus();
            });
        });

        // Keyboard shortcut: Ctrl+S to save
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.savePage();
            }
        });
    },

    async loadPages() {
        try {
            const res = await fetch('/api/docs');
            if (res.ok) {
                this.pages = await res.json();
                this.renderPageList();
            }
        } catch (e) {
            console.error('Failed to load pages:', e);
        }
    },

    renderPageList() {
        const list = document.getElementById('docs-list');
        list.innerHTML = '';

        this.pages.forEach(page => {
            const item = document.createElement('div');
            item.className = 'doc-item' + (this.activePage && this.activePage.id === page.id ? ' active' : '');
            item.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span class="doc-title">${page.title || 'Untitled'}</span>
            `;
            item.addEventListener('click', () => this.selectPage(page));
            list.appendChild(item);
        });
    },

    async selectPage(page) {
        // Load full page content
        try {
            const res = await fetch(`/api/docs/${page.id}`);
            if (res.ok) {
                this.activePage = await res.json();
                this.renderEditor();
                this.renderPageList();
                this.unsaved = false;
            }
        } catch (e) {
            console.error('Failed to load page:', e);
        }
    },

    renderEditor() {
        if (!this.activePage) return;

        document.getElementById('doc-title-input').value = this.activePage.title || '';
        document.getElementById('editor-body').innerHTML = this.activePage.content || '';
        document.getElementById('editor-meta').textContent = this.activePage.updated_at
            ? 'Last saved ' + App.formatDate(this.activePage.updated_at)
            : '';
    },

    async createPage() {
        try {
            const res = await fetch('/api/docs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'Untitled', content: '' })
            });
            if (res.ok) {
                const page = await res.json();
                await this.loadPages();
                this.selectPage(page);
            }
        } catch (e) {
            console.error('Failed to create page:', e);
        }
    },

    async savePage() {
        if (!this.activePage) return;

        const title = document.getElementById('doc-title-input').value.trim() || 'Untitled';
        const content = document.getElementById('editor-body').innerHTML;

        try {
            const res = await fetch(`/api/docs/${this.activePage.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content })
            });
            if (res.ok) {
                this.activePage = await res.json();
                this.unsaved = false;
                document.getElementById('editor-meta').textContent = 'Last saved ' + App.formatDate(this.activePage.updated_at);
                await this.loadPages();
            }
        } catch (e) {
            console.error('Failed to save page:', e);
        }
    },

    async deletePage() {
        if (!this.activePage) return;
        if (!confirm('Delete this page?')) return;

        try {
            const res = await fetch(`/api/docs/${this.activePage.id}`, { method: 'DELETE' });
            if (res.ok) {
                this.activePage = null;
                document.getElementById('doc-title-input').value = '';
                document.getElementById('editor-body').innerHTML = '';
                document.getElementById('editor-meta').textContent = '';
                await this.loadPages();
            }
        } catch (e) {
            console.error('Failed to delete page:', e);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Docs.init();
});
