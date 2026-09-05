document.addEventListener('DOMContentLoaded', () => {
    const client = window.supabaseClient || window.supabase;

    let currentUser = null;
    let activeCamTarget = 'chat';
    let mediaRecorder = null;
    let chunks = [];
    let videoStream = null;

    // متغيرات التعديل والاستبدال
    let currentEditId = null;
    let currentEditTable = null;

    // تسجيل الدخول
    const authForm = document.getElementById('auth-form');
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const { error } = await client.auth.signInWithPassword({ email, password });
            if (error) alert(error.message);
            else initApp();
        });
    }

    document.getElementById('btn-anon').addEventListener('click', async () => {
        const anonEmail = `guest_${Date.now()}@loome.com`;
        await client.auth.signUp({ email: anonEmail, password: "Guest123456!" });
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
        fetchPosts();

        client.channel('chat-room').on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, fetchChat).subscribe();
    }

    // --- عرض محتوى الوسائط والملفات والنصوص ---
    function renderMediaContent(content) {
        if (!content) return '';

        if (content.startsWith('[AUDIO]:')) {
            return `<audio controls src="${content.replace('[AUDIO]:', '')}" style="max-width:100%; height:35px;"></audio>`;
        }
        if (content.startsWith('[IMAGE]:')) {
            return `<img src="${content.replace('[IMAGE]:', '')}" style="max-width:100%; border-radius:8px;">`;
        }
        if (content.startsWith('[VIDEO]:')) {
            return `<video controls src="${content.replace('[VIDEO]:', '')}" style="max-width:100%; border-radius:8px;"></video>`;
        }
        if (content.startsWith('[FILE]:')) {
            const url = content.replace('[FILE]:', '');
            const rawName = url.split('/').pop().split('_').slice(2).join('_') || 'تحميل الملف';
            return `<a href="${url}" target="_blank" download style="display:inline-flex; align-items:center; gap:6px; padding:8px 12px; background:#e7f3ff; border-radius:8px; text-decoration:none; color:#0084ff; font-weight:bold; font-size:13px;">📄 ${rawName}</a>`;
        }
        return `<div>${content}</div>`;
    }

    // --- أزرار التحكم بالتعديل والاستبدال والحذف ---
    function renderActionButtons(id, table, isMe, currentContent) {
        if (!isMe) return '';
        const isMedia = currentContent.startsWith('[AUDIO]:') || currentContent.startsWith('[IMAGE]:') || currentContent.startsWith('[VIDEO]:') || currentContent.startsWith('[FILE]:');

        return `
            <div class="msg-actions">
                ${isMedia ? 
                    `<span onclick="triggerReplaceFile('${id}', '${table}')">🔄 استبدال الملف</span>` : 
                    `<span onclick="openEditModal('${id}', '${table}', \`${currentContent.replace(/`/g, '\\`')}\`)">✏️ تعديل</span>`
                }
                <span onclick="deleteItem('${id}', '${table}')" style="color:#ff4d4d;">🗑️ حذف</span>
            </div>
        `;
    }

    // --- 1. الدردشة الجماعية ---
    async function fetchChat() {
        const box = document.getElementById('chat-box');
        const { data } = await client.from('messages').select('*').order('created_at', { ascending: true });
        if (!data) return;

        const myEmail = currentUser ? (currentUser.email || 'زائر') : 'زائر';
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

    // --- 2. الرسائل الخاصة ---
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
        if (!input.value.trim() || !target) return alert("أدخل بريد المستلم ورسالتك");

        await client.from('direct_messages').insert([{ content: input.value.trim(), sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
        input.value = '';
        fetchDM();
    });

    document.getElementById('dm-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'dm'));

    // --- 3. المنشورات العامة ---
    document.getElementById('post-file-input').addEventListener('change', (e) => uploadAndSend(e.target.files[0], 'post'));

    document.getElementById('btn-send-post').addEventListener('click', async () => {
        const input = document.getElementById('post-input');
        let text = input.value.trim();
        if (!text) return;

        await client.from('posts').insert([{ content: text, user_id: currentUser?.id, sender_email: currentUser?.email || 'زائر' }]);
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
                <div style="background:#fff; padding:10px; border-radius:8px; border:1px solid #e4e6eb;">
                    ${renderMediaContent(p.content)}
                    ${renderActionButtons(p.id, 'posts', isMe, p.content)}
                </div>
            `;
        }).join('');
    }

    // --- عمليات الحذف والتعديل والاستبدال ---
    window.deleteItem = async (id, table) => {
        if (!confirm("هل أنت تأكد من رغبتك في حذف هذا العنصر؟")) return;

        const { error } = await client.from(table).delete().eq('id', id);
        if (error) alert("حدث خطأ أثناء الحذف: " + error.message);
        else refreshCurrentTab(table);
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
            refreshCurrentTab(currentEditTable);
        }
    });

    // استبدال ملف أو صورة أو فيديو قديم بأحد جديد
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
        const newContent = `${prefix}${url}`;

        const { error: updateError } = await client.from(currentEditTable).update({ content: newContent }).eq('id', currentEditId);
        if (updateError) alert("فشل الاستبدال: " + updateError.message);
        else refreshCurrentTab(currentEditTable);
    });

    function refreshCurrentTab(table) {
        if (table === 'messages') fetchChat();
        if (table === 'direct_messages') fetchDM();
        if (table === 'posts') fetchPosts();
    }

    // --- رفع الملفات الجديدة ---
    async function uploadAndSend(file, type) {
        if (!file) return;

        let bucket = 'chat-files';
        let prefix = '[FILE]:';

        if (file.type.startsWith('image/')) { bucket = 'chat-images'; prefix = '[IMAGE]:'; }
        else if (file.type.startsWith('video/')) { bucket = 'chat-videos'; prefix = '[VIDEO]:'; }
        else if (file.type.startsWith('audio/')) { bucket = 'audio-messages'; prefix = '[AUDIO]:'; }

        const fileName = `${type}_${Date.now()}_${file.name}`;
        if (type === 'post') document.getElementById('post-file-status').innerText = "جاري رفع الملف...";

        const { error } = await client.storage.from(bucket).upload(fileName, file);
        if (error) {
            if (type === 'post') document.getElementById('post-file-status').innerText = "";
            return alert("فشل الرفع: " + error.message);
        }

        const url = client.storage.from(bucket).getPublicUrl(fileName).data.publicUrl;
        const formatted = `${prefix}${url}`;

        if (type === 'chat') {
            await client.from('messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر' }]);
            fetchChat();
        } else if (type === 'dm') {
            const target = dmTarget.value.trim();
            if (!target) return alert("أدخل بريد المستلم");
            await client.from('direct_messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
            fetchDM();
        } else if (type === 'post') {
            await client.from('posts').insert([{ content: formatted, user_id: currentUser?.id, sender_email: currentUser?.email || 'زائر' }]);
            document.getElementById('post-file-status').innerText = "";
            fetchPosts();
        }
    }

    // --- التسجيل الصوتي ---
    function setupMic(btnId, targetType) {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        btn.addEventListener('click', async () => {
            if (!mediaRecorder || mediaRecorder.state === 'inactive') {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    chunks = [];
                    mediaRecorder.ondataavailable = e => chunks.push(e.data);
                    mediaRecorder.onstop = async () => {
                        const blob = new Blob(chunks, { type: 'audio/webm' });
                        const fileName = `voice_${Date.now()}.webm`;

                        await client.storage.from('audio-messages').upload(fileName, blob);
                        const url = client.storage.from('audio-messages').getPublicUrl(fileName).data.publicUrl;
                        const formatted = `[AUDIO]:${url}`;

                        if (targetType === 'chat') {
                            await client.from('messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر' }]);
                            fetchChat();
                        } else if (targetType === 'dm') {
                            const target = dmTarget.value.trim();
                            if (target) {
                                await client.from('direct_messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
                                fetchDM();
                            }
                        } else if (targetType === 'post') {
                            await client.from('posts').insert([{ content: formatted, user_id: currentUser?.id, sender_email: currentUser?.email || 'زائر' }]);
                            fetchPosts();
                        }
                        btn.style.background = '#28a745';
                    };
                    mediaRecorder.start();
                    btn.style.background = '#dc3545';
                } catch (err) { alert("يرجى تفعيل الميكروفون."); }
            } else { mediaRecorder.stop(); }
        });
    }

    setupMic('btn-chat-mic', 'chat');
    setupMic('btn-dm-mic', 'dm');
    setupMic('btn-post-mic', 'post');

    // --- تسجيل الفيديو المباشر ---
    const videoModal = document.getElementById('video-modal');
    const videoPreview = document.getElementById('video-preview');

    function setupCamTrigger(btnId, targetType) {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        btn.addEventListener('click', async () => {
            if (targetType === 'dm' && !dmTarget.value.trim()) return alert("أدخل بريد المستلم أولاً.");
            activeCamTarget = targetType;
            try {
                videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                videoPreview.srcObject = videoStream;
                videoModal.style.display = 'flex';

                chunks = [];
                mediaRecorder = new MediaRecorder(videoStream);
                mediaRecorder.ondataavailable = e => chunks.push(e.data);
                mediaRecorder.onstop = async () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    const fileName = `cam_${Date.now()}.webm`;

                    await client.storage.from('chat-videos').upload(fileName, blob);
                    const url = client.storage.from('chat-videos').getPublicUrl(fileName).data.publicUrl;
                    const formatted = `[VIDEO]:${url}`;

                    if (activeCamTarget === 'chat') {
                        await client.from('messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر' }]);
                        fetchChat();
                    } else if (activeCamTarget === 'dm') {
                        const target = dmTarget.value.trim();
                        await client.from('direct_messages').insert([{ content: formatted, sender_email: currentUser?.email || 'زائر', receiver_email: target }]);
                        fetchDM();
                    } else if (activeCamTarget === 'post') {
                        await client.from('posts').insert([{ content: formatted, user_id: currentUser?.id, sender_email: currentUser?.email || 'زائر' }]);
                        fetchPosts();
                    }
                    closeCam();
                };
                mediaRecorder.start();
            } catch (err) { alert("يرجى إعطاء إذن استخدام الكاميرا والميكروفون."); }
        });
    }

    setupCamTrigger('btn-chat-cam', 'chat');
    setupCamTrigger('btn-dm-cam', 'dm');
    setupCamTrigger('btn-post-cam', 'post');

    document.getElementById('btn-stop-video').addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    });

    document.getElementById('btn-cancel-video').addEventListener('click', closeCam);

    function closeCam() {
        if (videoStream) videoStream.getTracks().forEach(t => t.stop());
        videoModal.style.display = 'none';
    }

    (async () => {
        const { data: { user } } = await client.auth.getUser();
        if (user) initApp();
    })();
});
