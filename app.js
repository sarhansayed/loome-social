document.addEventListener('DOMContentLoaded', () => {
    const client = window.supabaseClient || window.supabase;

    let currentUser = null;
    let currentEditId = null;
    let currentEditTable = null;
    let jitsiApi = null;

    // --- التسجيل والتحقق من المستخدم ---
    const authForm = document.getElementById('auth-form');
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const { error } = await client.auth.signInWithPassword({ email, password });
            if (error) alert("خطأ: " + error.message);
            else initApp();
        });
    }

    document.getElementById('btn-anon').addEventListener('click', async () => {
        const anonEmail = `visitor_${Math.floor(Math.random() * 10000)}@loome.com`;
        await client.auth.signUp({ email: anonEmail, password: "Visitor123456!" });
        initApp();
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
        await client.auth.signOut();
        location.reload();
    });

    async function initApp() {
        const { data: { user } } = await client.auth.getUser();
        currentUser = user;
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('main-content').style.display = 'flex';

        fetchChat();
        fetchRooms();
        fetchPosts();

        // التحديث الفوري المباشر للرسائل
        client.channel('chat-room').on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, fetchChat).subscribe();
    }

    // --- عرض المحتوى وتنسيقه ---
    function renderMediaContent(content) {
        if (!content) return '';
        if (content.startsWith('[IMAGE]:')) return `<img src="${content.replace('[IMAGE]:', '')}" style="max-width:100%; border-radius:12px; margin-top:5px;">`;
        if (content.startsWith('[VIDEO]:')) return `<video controls src="${content.replace('[VIDEO]:', '')}" style="max-width:100%; border-radius:12px; margin-top:5px;"></video>`;
        if (content.startsWith('[AUDIO]:')) return `<audio controls src="${content.replace('[AUDIO]:', '')}" style="max-width:100%; height:35px; margin-top:5px;"></audio>`;
        if (content.startsWith('[FILE]:')) {
            const url = content.replace('[FILE]:', '');
            return `<a href="${url}" target="_blank" download style="display:inline-flex; align-items:center; gap:6px; padding:8px 12px; background:#edf2f7; border-radius:8px; text-decoration:none; color:#2b6cb0; font-weight:bold; font-size:12px; margin-top:5px;">📄 تحميل المستند</a>`;
        }
        return `<div>${content}</div>`;
    }

    // --- أزرار الحذف والتعديل المفعلة لكافة الرسائل الشاملة للقديمة والجديدة ---
    function renderActionButtons(id, table, isMe, currentContent) {
        if (!isMe) return '';
        const isMedia = currentContent.startsWith('[AUDIO]:') || currentContent.startsWith('[IMAGE]:') || currentContent.startsWith('[VIDEO]:') || currentContent.startsWith('[FILE]:');

        return `
            <div class="msg-actions">
                ${isMedia ? 
                    `<span onclick="triggerReplaceFile('${id}', '${table}')">🔄 استبدال</span>` : 
                    `<span onclick="openEditModal('${id}', '${table}', \`${currentContent.replace(/`/g, '\\`')}\`)">✏️ تعديل</span>`
                }
                <span onclick="deleteItem('${id}', '${table}')" style="color:#e53e3e;">🗑️ حذف</span>
            </div>
        `;
    }

    // --- 1. الدردشة الجماعية العامة ---
    async function fetchChat() {
        const box = document.getElementById('chat-box');
        const { data } = await client.from('messages').select('*').order('created_at', { ascending: true });
        if (!data) return;

        const myEmail = currentUser?.email || 'زائر';
        box.innerHTML = data.map(m => {
            const isMe = m.sender_email === myEmail;
            return `
                <div class="message-bubble ${isMe ? 'msg-me' : 'msg-other'}">
                    <div style="font-size:10px; opacity:0.8; margin-bottom:2px;">${isMe ? 'أنت' : m.sender_email}</div>
                    ${renderMediaContent(m.content)}
                    ${renderActionButtons(m.id, 'messages', isMe, m.content)}
                </div>
            `;
        }).join('');
        box.scrollTop = box.scrollHeight;
    }

    document.getElementById('btn-send-chat').addEventListener('click', async () => {
        const input = document.getElementById('chat-input');
        if (!input.value.trim()) return;
        await client.from('messages').insert([{ content: input.value.trim(), sender_email: currentUser?.email || 'زائر' }]);
        input.value = '';
        fetchChat();
    });

    document.getElementById('chat-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'chat'));

    // --- 2. إدارة الغرف الخاصة بالزوار والأعضاء ---
    document.getElementById('btn-open-create-room').addEventListener('click', () => {
        document.getElementById('create-room-modal').style.display = 'flex';
    });
    document.getElementById('btn-cancel-room').addEventListener('click', () => {
        document.getElementById('create-room-modal').style.display = 'none';
    });

    document.getElementById('btn-save-room').addEventListener('click', async () => {
        const name = document.getElementById('new-room-name').value.trim();
        const approval = document.getElementById('room-approval-required').checked;
        if (!name) return alert("أدخل اسم الغرفة");

        await client.from('rooms').insert([{ 
            name, 
            owner_email: currentUser?.email || 'زائر',
            requires_approval: approval
        }]);

        document.getElementById('create-room-modal').style.display = 'none';
        document.getElementById('new-room-name').value = '';
        fetchRooms();
    });

    async function fetchRooms() {
        const box = document.getElementById('rooms-list');
        const { data } = await client.from('rooms').select('*').order('created_at', { ascending: false });
        if (!data) return;

        const myEmail = currentUser?.email || 'زائر';
        box.innerHTML = data.map(r => {
            const isOwner = r.owner_email === myEmail;
            return `
                <div class="room-card">
                    <div>
                        <h4>🔒 ${r.name}</h4>
                        <div style="font-size:11px; color:#718096;">المنشئ: ${isOwner ? 'أنت' : r.owner_email}</div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button onclick="startMeeting('${r.name}')" style="padding:6px 12px; border-radius:8px; border:none; background:var(--accent-grad); color:white; font-size:12px; font-weight:bold; cursor:pointer;">📹 دخول الاجتماع</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // --- 3. المحادثات الخاصة ---
    const dmTarget = document.getElementById('dm-target-email');
    dmTarget.addEventListener('change', fetchDM);

    async function fetchDM() {
        const target = dmTarget.value.trim();
        const box = document.getElementById('dm-box');
        if (!target) return;

        const myEmail = currentUser?.email || 'زائر';
        const { data } = await client.from('direct_messages').select('*')
            .or(`and(sender_email.eq.${myEmail},receiver_email.eq.${target}),and(sender_email.eq.${target},receiver_email.eq.${myEmail})`)
            .order('created_at', { ascending: true });

        box.innerHTML = (data || []).map(m => {
            const isMe = m.sender_email === myEmail;
            return `
                <div class="message-bubble ${isMe ? 'msg-me' : 'msg-other'}">
                    ${renderMediaContent(m.content)}
                    ${renderActionButtons(m.id, 'direct_messages', isMe, m.content)}
                </div>
            `;
        }).join('');
        box.scrollTop = box.scrollHeight;
    }

    document.getElementById('btn-send-dm').addEventListener('click', async () => {
        const input = document.getElementById('dm-input');
        const target = dmTarget.value.trim();
        if (!input.value.trim() || !target) return alert("أدخل بريد المستلم والرسالة");

        await client.from('direct_messages').insert([{ content: input.value.trim(), sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
        input.value = '';
        fetchDM();
    });

    document.getElementById('dm-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'dm'));

    // --- 4. المنشورات العامة ---
    document.getElementById('post-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'post'));

    document.getElementById('btn-send-post').addEventListener('click', async () => {
        const input = document.getElementById('post-input');
        if (!input.value.trim()) return;

        await client.from('posts').insert([{ content: input.value.trim(), user_id: currentUser?.id, sender_email: currentUser?.email || 'زائر' }]);
        input.value = '';
        fetchPosts();
    });

    async function fetchPosts() {
        const box = document.getElementById('posts-box');
        const { data } = await client.from('posts').select('*').order('created_at', { ascending: false });
        if (!data) return;

        const myEmail = currentUser?.email || 'زائر';
        box.innerHTML = data.map(p => {
            const isMe = p.sender_email === myEmail || p.user_id === currentUser?.id;
            return `
                <div style="background:#ffffff; padding:15px; border-radius:12px; border:1px solid var(--border);">
                    <div style="font-size:12px; font-weight:bold; color:#4a5568; margin-bottom:6px;">${p.sender_email}</div>
                    ${renderMediaContent(p.content)}
                    ${renderActionButtons(p.id, 'posts', isMe, p.content)}
                </div>
            `;
        }).join('');
    }

    // --- دمج وتفعيل الاجتماعات الصوتية والفيديو (المحادثة الجماعية الحية) ---
    document.getElementById('btn-start-global-meeting').addEventListener('click', () => startMeeting('Loome-Global-Room'));
    document.getElementById('btn-close-meeting').addEventListener('click', closeMeeting);

    window.startMeeting = (roomName) => {
        document.getElementById('meeting-modal').style.display = 'flex';
        document.getElementById('meeting-title').innerText = `📹 اجتماع حي: ${roomName}`;

        const domain = 'meet.jit.si';
        const options = {
            roomName: `LoomeApp_${roomName.replace(/\s+/g, '_')}`,
            width: '100%',
            height: '100%',
            parentNode: document.querySelector('#jitsi-container'),
            userInfo: {
                displayName: currentUser?.email || 'زائر Loome'
            },
            configOverwrite: { startWithAudioMuted: false, startWithVideoMuted: false },
            interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false }
        };
        
        document.querySelector('#jitsi-container').innerHTML = '';
        jitsiApi = new JitsiMeetExternalAPI(domain, options);
    };

    function closeMeeting() {
        if (jitsiApi) jitsiApi.dispose();
        document.getElementById('meeting-modal').style.display = 'none';
    }

    // --- دوال الحذف والتعديل والاستبدال لكل الأوقات (الرسائل القديمة والجديدة) ---
    window.deleteItem = async (id, table) => {
        if (!confirm("هل أنت تأكد من رغبتك في حذف هذا العنصر؟")) return;

        const { error } = await client.from(table).delete().eq('id', id);
        if (error) alert("حدث خطأ أثناء الحذف: " + error.message);
        else refreshTab(table);
    };

    window.openEditModal = (id, table, oldContent) => {
        currentEditId = id;
        currentEditTable = table;
        document.getElementById('edit-input').value = oldContent;
        document.getElementById('edit-modal').style.display = 'flex';
    };

    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
        document.getElementById('edit-modal').style.display = 'none';
    });

    document.getElementById('btn-save-edit').addEventListener('click', async () => {
        const newText = document.getElementById('edit-input').value.trim();
        if (!newText) return;

        const { error } = await client.from(currentEditTable).update({ content: newText }).eq('id', currentEditId);
        if (error) alert("فشل التعديل: " + error.message);
        else {
            document.getElementById('edit-modal').style.display = 'none';
            refreshTab(currentEditTable);
        }
    });

    window.triggerReplaceFile = (id, table) => {
        currentEditId = id;
        currentEditTable = table;
        document.getElementById('replace-file-input').click();
    };

    document.getElementById('replace-file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        let bucket = 'chat-files';
        let prefix = '[FILE]:';

        if (file.type.startsWith('image/')) { bucket = 'chat-images'; prefix = '[IMAGE]:'; }
        else if (file.type.startsWith('video/')) { bucket = 'chat-videos'; prefix = '[VIDEO]:'; }
        else if (file.type.startsWith('audio/')) { bucket = 'audio-messages'; prefix = '[AUDIO]:'; }

        const fileName = `replaced_${Date.now()}_${file.name}`;
        const { error: uploadError } = await client.storage.from(bucket).upload(fileName, file);
        if (uploadError) return alert("فشل رفع الملف الجديد: " + uploadError.message);

        const url = client.storage.from(bucket).getPublicUrl(fileName).data.publicUrl;
        const { error: updateError } = await client.from(currentEditTable).update({ content: `${prefix}${url}` }).eq('id', currentEditId);
        
        if (updateError) alert("فشل التحديث: " + updateError.message);
        else refreshTab(currentEditTable);
    });

    function refreshTab(table) {
        if (table === 'messages') fetchChat();
        if (table === 'direct_messages') fetchDM();
        if (table === 'posts') fetchPosts();
    }

    async function uploadAndSend(file, type) {
        if (!file) return;

        let bucket = 'chat-files';
        let prefix = '[FILE]:';

        if (file.type.startsWith('image/')) { bucket = 'chat-images'; prefix = '[IMAGE]:'; }
        else if (file.type.startsWith('video/')) { bucket = 'chat-videos'; prefix = '[VIDEO]:'; }
        else if (file.type.startsWith('audio/')) { bucket = 'audio-messages'; prefix = '[AUDIO]:'; }

        const fileName = `${type}_${Date.now()}_${file.name}`;
        const { error } = await client.storage.from(bucket).upload(fileName, file);
        if (error) return alert("فشل الرفع: " + error.message);

        const url = client.storage.from(bucket).getPublicUrl(fileName).data.publicUrl;
        const formatted = `${prefix}${url}`;

        if (type === 'chat') {
            await client.from('messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر' }]);
            fetchChat();
        } else if (type === 'dm') {
            const target = dmTarget.value.trim();
            if (target) {
                await client.from('direct_messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
                fetchDM();
            }
        } else if (type === 'post') {
            await client.from('posts').insert([{ content: formatted, user_id: currentUser?.id, sender_email: currentUser?.email || 'زائر' }]);
            fetchPosts();
        }
    }

    (async () => {
        const { data: { user } } = await client.auth.getUser();
        if (user) initApp();
    })();
});
