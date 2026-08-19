import os
import sqlite3
import json
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, g

app = Flask(__name__)
app.secret_key = 'teamspace-internal-key-change-in-production'

DATABASE = os.path.join(os.path.dirname(__file__), 'teamspace.db')


# --- Database helpers ---

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA journal_mode=WAL')
        g.db.execute('PRAGMA foreign_keys=ON')
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            colour TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id INTEGER NOT NULL,
            author_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
            FOREIGN KEY (author_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT 'Untitled',
            content TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS call_participants (
            user_id INTEGER PRIMARY KEY,
            joined_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS call_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user INTEGER NOT NULL,
            to_user INTEGER NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (from_user) REFERENCES users(id),
            FOREIGN KEY (to_user) REFERENCES users(id)
        );
    ''')

    # Seed default users if empty
    cursor = db.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        colours = ['#6c8cff', '#f25f5c', '#4ecb71', '#f4a940', '#a855f7']
        names = ['Alice', 'Bob', 'Charlie', 'Dana', 'Eve']
        for i, name in enumerate(names):
            db.execute('INSERT INTO users (name, colour) VALUES (?, ?)', (name, colours[i]))

    # Seed a default general channel if empty
    cursor = db.execute('SELECT COUNT(*) FROM channels')
    if cursor.fetchone()[0] == 0:
        db.execute("INSERT INTO channels (name, description) VALUES ('general', 'General discussion')")

    db.commit()
    db.close()


# --- Auth (simple session-based, pick a user) ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user_id = request.form.get('user_id') or request.json.get('user_id')
        session['user_id'] = int(user_id)
        return redirect(url_for('chat'))

    db = get_db()
    users = db.execute('SELECT id, name, colour FROM users').fetchall()
    return render_template('login.html', users=users)


@app.route('/logout')
def logout():
    session.pop('user_id', None)
    return redirect(url_for('login'))


def get_current_user():
    user_id = session.get('user_id')
    if not user_id:
        return None
    db = get_db()
    return db.execute('SELECT id, name, colour FROM users WHERE id = ?', (user_id,)).fetchone()


# --- Page routes ---

@app.route('/')
def index():
    if not session.get('user_id'):
        return redirect(url_for('login'))
    return redirect(url_for('chat'))


@app.route('/chat')
def chat():
    if not session.get('user_id'):
        return redirect(url_for('login'))
    return render_template('chat.html')


@app.route('/docs')
def docs():
    if not session.get('user_id'):
        return redirect(url_for('login'))
    return render_template('docs.html')


@app.route('/call')
def call():
    if not session.get('user_id'):
        return redirect(url_for('login'))
    return render_template('call.html')


# --- API: Current user ---

@app.route('/api/me')
def api_me():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in'}), 401
    return jsonify({'id': user['id'], 'name': user['name'], 'colour': user['colour']})


# --- API: Channels ---

@app.route('/api/channels', methods=['GET'])
def api_channels():
    db = get_db()
    channels = db.execute('SELECT id, name, description, created_at FROM channels ORDER BY name').fetchall()
    return jsonify([dict(ch) for ch in channels])


@app.route('/api/channels', methods=['POST'])
def api_create_channel():
    data = request.get_json()
    name = data.get('name', '').strip().lower().replace(' ', '-')
    description = data.get('description', '').strip()

    if not name:
        return jsonify({'error': 'Name required'}), 400

    db = get_db()
    try:
        db.execute('INSERT INTO channels (name, description) VALUES (?, ?)', (name, description))
        db.commit()
        channel = db.execute('SELECT id, name, description, created_at FROM channels WHERE name = ?', (name,)).fetchone()
        return jsonify(dict(channel)), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Channel already exists'}), 409


# --- API: Messages ---

@app.route('/api/channels/<int:channel_id>/messages', methods=['GET'])
def api_messages(channel_id):
    db = get_db()
    messages = db.execute('''
        SELECT m.id, m.text, m.created_at, m.author_id, u.name as author_name
        FROM messages m
        JOIN users u ON u.id = m.author_id
        WHERE m.channel_id = ?
        ORDER BY m.created_at ASC
    ''', (channel_id,)).fetchall()
    return jsonify([dict(msg) for msg in messages])


@app.route('/api/channels/<int:channel_id>/messages', methods=['POST'])
def api_send_message(channel_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in'}), 401

    data = request.get_json()
    text = data.get('text', '').strip()

    if not text:
        return jsonify({'error': 'Message text required'}), 400

    db = get_db()
    db.execute('INSERT INTO messages (channel_id, author_id, text) VALUES (?, ?, ?)',
               (channel_id, user['id'], text))
    db.commit()
    return jsonify({'ok': True}), 201


# --- API: Docs ---

@app.route('/api/docs', methods=['GET'])
def api_docs_list():
    db = get_db()
    pages = db.execute('SELECT id, title, updated_at FROM docs ORDER BY updated_at DESC').fetchall()
    return jsonify([dict(p) for p in pages])


@app.route('/api/docs', methods=['POST'])
def api_docs_create():
    data = request.get_json()
    title = data.get('title', 'Untitled').strip()
    content = data.get('content', '')

    db = get_db()
    cursor = db.execute('INSERT INTO docs (title, content) VALUES (?, ?)', (title, content))
    db.commit()

    page = db.execute('SELECT id, title, content, created_at, updated_at FROM docs WHERE id = ?',
                      (cursor.lastrowid,)).fetchone()
    return jsonify(dict(page)), 201


@app.route('/api/docs/<int:doc_id>', methods=['GET'])
def api_docs_get(doc_id):
    db = get_db()
    page = db.execute('SELECT id, title, content, created_at, updated_at FROM docs WHERE id = ?', (doc_id,)).fetchone()
    if not page:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(dict(page))


@app.route('/api/docs/<int:doc_id>', methods=['PUT'])
def api_docs_update(doc_id):
    data = request.get_json()
    title = data.get('title', 'Untitled').strip()
    content = data.get('content', '')

    db = get_db()
    db.execute("UPDATE docs SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?",
               (title, content, doc_id))
    db.commit()

    page = db.execute('SELECT id, title, content, created_at, updated_at FROM docs WHERE id = ?', (doc_id,)).fetchone()
    if not page:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(dict(page))


@app.route('/api/docs/<int:doc_id>', methods=['DELETE'])
def api_docs_delete(doc_id):
    db = get_db()
    db.execute('DELETE FROM docs WHERE id = ?', (doc_id,))
    db.commit()
    return jsonify({'ok': True})


# --- API: Voice Call ---

@app.route('/api/call/status', methods=['GET'])
def api_call_status():
    db = get_db()
    participants = db.execute('''
        SELECT u.id, u.name, u.colour, cp.joined_at
        FROM call_participants cp
        JOIN users u ON u.id = cp.user_id
        ORDER BY cp.joined_at
    ''').fetchall()
    return jsonify({'participants': [dict(p) for p in participants]})


@app.route('/api/call/join', methods=['POST'])
def api_call_join():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in'}), 401

    db = get_db()
    try:
        db.execute('INSERT INTO call_participants (user_id) VALUES (?)', (user['id'],))
        db.commit()
    except sqlite3.IntegrityError:
        pass  # Already in call

    return jsonify({'ok': True})


@app.route('/api/call/leave', methods=['POST'])
def api_call_leave():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in'}), 401

    db = get_db()
    db.execute('DELETE FROM call_participants WHERE user_id = ?', (user['id'],))
    # Clean up signals involving this user
    db.execute('DELETE FROM call_signals WHERE from_user = ? OR to_user = ?', (user['id'], user['id']))
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/call/signal', methods=['POST'])
def api_call_signal():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in'}), 401

    data = request.get_json()
    to_user = data.get('to')
    sig_type = data.get('type')

    payload = {}
    if 'sdp' in data:
        payload['sdp'] = data['sdp']
    if 'candidate' in data:
        payload['candidate'] = data['candidate']

    db = get_db()
    db.execute('INSERT INTO call_signals (from_user, to_user, type, payload) VALUES (?, ?, ?, ?)',
               (user['id'], to_user, sig_type, json.dumps(payload)))
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/call/poll', methods=['GET'])
def api_call_poll():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in'}), 401

    db = get_db()

    # Get participants
    participants = db.execute('''
        SELECT u.id, u.name, u.colour
        FROM call_participants cp
        JOIN users u ON u.id = cp.user_id
        ORDER BY cp.joined_at
    ''').fetchall()

    # Get signals addressed to this user
    signals = db.execute('''
        SELECT id, from_user, type, payload
        FROM call_signals
        WHERE to_user = ?
        ORDER BY created_at
    ''', (user['id'],)).fetchall()

    # Build signal list and delete consumed signals
    signal_list = []
    for sig in signals:
        payload = json.loads(sig['payload'])
        signal_list.append({
            'from': sig['from_user'],
            'type': sig['type'],
            **payload
        })

    if signals:
        ids = [sig['id'] for sig in signals]
        placeholders = ','.join('?' * len(ids))
        db.execute(f'DELETE FROM call_signals WHERE id IN ({placeholders})', ids)
        db.commit()

    # Determine new peers (other participants we might need to connect to)
    new_peers = [p['id'] for p in participants if p['id'] != user['id']]

    return jsonify({
        'participants': [dict(p) for p in participants],
        'signals': signal_list,
        'new_peers': new_peers
    })


# --- Initialise and run ---

if __name__ == '__main__':
    init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)
