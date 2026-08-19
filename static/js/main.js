// Shared utilities and user session management

const App = {
    currentUser: null,

    async init() {
        await this.loadCurrentUser();
        this.renderUserNav();
    },

    async loadCurrentUser() {
        try {
            const res = await fetch('/api/me');
            if (res.ok) {
                this.currentUser = await res.json();
            }
        } catch (e) {
            console.error('Failed to load user:', e);
        }
    },

    renderUserNav() {
        const avatarEl = document.getElementById('current-user-avatar');
        const nameEl = document.getElementById('current-user-name');
        if (this.currentUser && avatarEl && nameEl) {
            avatarEl.textContent = this.currentUser.name.charAt(0).toUpperCase();
            avatarEl.style.background = this.currentUser.colour;
            nameEl.textContent = this.currentUser.name;
        }
    },

    // Colour palette for avatars
    colours: ['#6c8cff', '#f25f5c', '#4ecb71', '#f4a940', '#a855f7'],

    getColour(index) {
        return this.colours[index % this.colours.length];
    },

    // Format timestamp to readable time
    formatTime(isoString) {
        const d = new Date(isoString);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    formatDate(isoString) {
        const d = new Date(isoString);
        return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
