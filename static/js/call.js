// Voice call page logic

const Call = {
    inCall: false,
    micMuted: false,
    deafened: false,
    localStream: null,
    peers: {},       // peerId -> RTCPeerConnection
    pollInterval: null,

    init() {
        this.bindEvents();
        this.checkActiveCall();
    },

    bindEvents() {
        document.getElementById('btn-start-call').addEventListener('click', () => this.joinCall());
        document.getElementById('btn-end-call').addEventListener('click', () => this.leaveCall());
        document.getElementById('btn-toggle-mic').addEventListener('click', () => this.toggleMic());
        document.getElementById('btn-toggle-deafen').addEventListener('click', () => this.toggleDeafen());
    },

    async checkActiveCall() {
        try {
            const res = await fetch('/api/call/status');
            if (res.ok) {
                const data = await res.json();
                if (data.participants && data.participants.length > 0) {
                    this.renderParticipants(data.participants);
                }
            }
        } catch (e) {
            console.error('Failed to check call status:', e);
        }
    },

    async joinCall() {
        try {
            // Get microphone access
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Notify server
            const res = await fetch('/api/call/join', { method: 'POST' });
            if (!res.ok) return;

            this.inCall = true;
            document.getElementById('call-idle').classList.add('hidden');
            document.getElementById('call-active').classList.remove('hidden');

            // Start polling for signalling
            this.pollInterval = setInterval(() => this.pollSignalling(), 2000);
            await this.pollSignalling();
        } catch (e) {
            console.error('Failed to join call:', e);
            alert('Could not access microphone. Please allow microphone access.');
        }
    },

    async leaveCall() {
        // Close all peer connections
        Object.values(this.peers).forEach(pc => pc.close());
        this.peers = {};

        // Stop local audio
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }

        // Notify server
        try {
            await fetch('/api/call/leave', { method: 'POST' });
        } catch (e) {
            console.error('Failed to notify leave:', e);
        }

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        this.inCall = false;
        this.micMuted = false;
        this.deafened = false;
        document.getElementById('call-active').classList.add('hidden');
        document.getElementById('call-idle').classList.remove('hidden');
        document.getElementById('btn-toggle-mic').classList.remove('active');
        document.getElementById('btn-toggle-deafen').classList.remove('active');
    },

    toggleMic() {
        this.micMuted = !this.micMuted;
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.micMuted; });
        }
        document.getElementById('btn-toggle-mic').classList.toggle('active', this.micMuted);
    },

    toggleDeafen() {
        this.deafened = !this.deafened;
        // Mute all remote audio elements
        document.querySelectorAll('audio.remote-audio').forEach(el => {
            el.muted = this.deafened;
        });
        document.getElementById('btn-toggle-deafen').classList.toggle('active', this.deafened);
    },

    async pollSignalling() {
        try {
            const res = await fetch('/api/call/poll');
            if (!res.ok) return;

            const data = await res.json();

            // Update participant display
            if (data.participants) {
                this.renderParticipants(data.participants);
            }

            // Handle signalling messages (offers, answers, ICE candidates)
            if (data.signals) {
                for (const signal of data.signals) {
                    await this.handleSignal(signal);
                }
            }

            // Initiate connections to new participants
            if (data.new_peers) {
                for (const peerId of data.new_peers) {
                    if (!this.peers[peerId]) {
                        await this.createOffer(peerId);
                    }
                }
            }
        } catch (e) {
            console.error('Poll signalling error:', e);
        }
    },

    async createOffer(peerId) {
        const pc = this.createPeerConnection(peerId);
        this.peers[peerId] = pc;

        // Add local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await fetch('/api/call/signal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: peerId,
                type: 'offer',
                sdp: offer.sdp
            })
        });
    },

    async handleSignal(signal) {
        const { from, type, sdp, candidate } = signal;

        if (type === 'offer') {
            const pc = this.createPeerConnection(from);
            this.peers[from] = pc;

            if (this.localStream) {
                this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
            }

            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await fetch('/api/call/signal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: from,
                    type: 'answer',
                    sdp: answer.sdp
                })
            });

        } else if (type === 'answer') {
            const pc = this.peers[from];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
            }

        } else if (type === 'ice-candidate') {
            const pc = this.peers[from];
            if (pc && candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
        }
    },

    createPeerConnection(peerId) {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                fetch('/api/call/signal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: peerId,
                        type: 'ice-candidate',
                        candidate: e.candidate
                    })
                });
            }
        };

        pc.ontrack = (e) => {
            // Create audio element for remote stream
            let audio = document.getElementById('audio-' + peerId);
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = 'audio-' + peerId;
                audio.className = 'remote-audio';
                audio.autoplay = true;
                audio.muted = this.deafened;
                document.body.appendChild(audio);
            }
            audio.srcObject = e.streams[0];
        };

        return pc;
    },

    renderParticipants(participants) {
        const grid = document.getElementById('call-grid');
        grid.innerHTML = '';

        participants.forEach((p, i) => {
            const colour = App.getColour(p.id);
            const initial = p.name.charAt(0).toUpperCase();

            const el = document.createElement('div');
            el.className = 'call-participant';
            el.innerHTML = `
                <div class="participant-avatar" style="background:${colour}">${initial}</div>
                <span class="participant-name">${p.name}</span>
            `;
            grid.appendChild(el);
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Call.init();
});
