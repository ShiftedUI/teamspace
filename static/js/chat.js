// Chat page logic

const Chat = {
    channels: [],
    activeChannel: null,
    messages: [],
    pollInterval: null,

    async init() {
        await this.loadChannels();
        this.bindEvents();
        this.startPolling();
    },

    bindEvents() {
        // New channel modal
        document.getElementById('btn-new-channel').addEventListener('click', () => {
            document.getElementById('new-channel-modal').classList.add('visible');
            document.getElementById('new-channel-name').focus();
        });

        document.getElementById('btn-cancel-channel').addEventListener('click', () => {
            document.getElementById('new-channel-modal').classList.remove('visible');
        });

        document.getElementById('btn-create-channel').addEventListener('click', () => this.createChannel());

        document.getElementById('new-channel-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.createChannel();
        });

        // Close modal on overlay click
        document.getElementById('new-channel-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.remove('visible');
            }
        });

        // Message input
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('btn-send');

        input.addEventListener('input', () => {
            sendBtn.disabled = input.value.trim() === '';
            // Auto-resize textarea
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.value.trim()) this.sendMessage();
            }
        });

        sendBtn.addEventListener('click', () => this.sendMessage());
    },

    async loadChannels() {
        try {
            const res = await fetch('/api/channels');
            if (res.ok) {
                this.channels = await res.json();
                this.renderChannels();
            }
        } catch (e) {
            console.error('Failed to load channels:', e);
        }
    },

    renderChannels() {
        const list = document.getElementById('channel-list');
        list.innerHTML = '';

        this.channels.forEach(ch => {
            const item = document.createElement('div');
            item.className = 'channel-item' + (this.activeChannel && this.activeChannel.id === ch.id ? ' active' : '');
            item.innerHTML = `
                <span class="channel-hash">#</span>
                <span>${ch.name}</span>
            `;
            item.addEventListener('click', () => this.selectChannel(ch));
            list.appendChild(item);
        });
    },

    async selectChannel(channel) {
        this.activeChannel = channel;
        this.renderChannels();

        document.getElementById('active-channel-name').textContent = '# ' + channel.name;
        document.getElementById('active-channel-desc').textContent = channel.description || '';
        document.getElementById('chat-empty-state').classList.add('hidden');

        await this.loadMessages();
    },

    async loadMessages() {
        if (!this.activeChannel) return;

        try {
            const res = await fetch(`/api/channels/${this.activeChannel.id}/messages`);
            if (res.ok) {
                this.messages = await res.json();
                this.renderMessages();
            }
        } catch (e) {
            console.error('Failed to load messages:', e);
        }
    },

    renderMessages() {
        const container = document.getElementById('messages-container');
        const emptyState = document.getElementById('chat-empty-state');

        // Remove all messages but keep empty state element
        container.innerHTML = '';

        if (this.messages.length === 0) {
            container.appendChild(emptyState);
            emptyState.classList.remove('hidden');
            emptyState.querySelector('span').textContent = 'No messages yet. Say something!';
            return;
        }

        container.appendChild(emptyState);
        emptyState.classList.add('hidden');

        let lastAuthor = null;

        this.messages.forEach(msg => {
            const isContinued = (lastAuthor === msg.author_id);
            const el = document.createElement('div');
            el.className = 'message' + (isContinued ? ' continued' : '');

            const colour = App.getColour(msg.author_id);
            const initial = msg.author_name.charAt(0).toUpperCase();

            el.innerHTML = `
                <div class="message-avatar" style="background:${colour}">${initial}</div>
                <div class="message-body">
                    <div class="message-header">
                        <span class="message-author">${msg.author_name}</span>
                        <span class="message-time">${App.formatTime(msg.created_at)}</span>
                    </div>
                    <div class="message-text">${this.escapeHtml(msg.text)}</div>
                </div>
            `;

            container.appendChild(el);
            lastAuthor = msg.author_id;
        });

        container.scrollTop = container.scrollHeight;
    },

    async sendMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        if (!text || !this.activeChannel) return;

        input.value = '';
        input.style.height = 'auto';
        document.getElementById('btn-send').disabled = true;

        try {
            const res = await fetch(`/api/channels/${this.activeChannel.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            if (res.ok) {
                await this.loadMessages();
            }
        } catch (e) {
            console.error('Failed to send message:', e);
        }
    },

    async createChannel() {
        const nameInput = document.getElementById('new-channel-name');
        const descInput = document.getElementById('new-channel-desc');
        const name = nameInput.value.trim();
        const description = descInput.value.trim();

        if (!name) return;

        try {
            const res = await fetch('/api/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
            if (res.ok) {
                const channel = await res.json();
                nameInput.value = '';
                descInput.value = '';
                document.getElementById('new-channel-modal').classList.remove('visible');
                await this.loadChannels();
                this.selectChannel(channel);
            }
        } catch (e) {
            console.error('Failed to create channel:', e);
        }
    },

    startPolling() {
        // Poll for new messages every 3 seconds
        this.pollInterval = setInterval(() => {
            if (this.activeChannel) {
                this.loadMessages();
            }
        }, 3000);
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Chat.init();
});
