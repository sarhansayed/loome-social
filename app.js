document.addEventListener('DOMContentLoaded', () => {
    const client = window.supabaseClient || window.supabase;

    const authForm = document.getElementById('auth-form');
    const authTitle = document.getElementById('auth-title');
    const btnSubmit = document.getElementById('btn-submit');
    const toggleAuth = document.getElementById('toggle-auth');
    const toggleMsg = document.getElementById('toggle-msg');
    const authError = document.getElementById('auth-error');
    const btnAnon = document.getElementById('btn-anon');

    const authContainer = document.getElementById('auth-container');
    const mainContent = document.getElementById('main-content');
    const btnLogout = document.getElementById('btn-logout');

    let isSignUp = false;

    if (toggleAuth) {
        toggleAuth.addEventListener('click', (e) => {
            e.preventDefault();
            isSignUp = !isSignUp;
            authTitle.textContent = isSignUp ? "إنشاء حساب جديد" : "تسجيل الدخول";
            btnSubmit.textContent = isSignUp ? "إنشاء حساب" : "تسجيل الدخول";
            toggleMsg.textContent = isSignUp ? "لديك حساب بالفعل؟" : "ليس لديك حساب؟";
            toggleAuth.textContent = isSignUp ? "تسجيل الدخول" : "إنشاء حساب جديد";
            authError.style.display = 'none';
        });
    }

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            authError.style.display = 'none';
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                if (isSignUp) {
                    const { data, error } = await client.auth.signUp({ email, password });
                    if (error) throw error;
                    alert("تم إنشاء الحساب بنجاح!");
                    showMainContent();
                } else {
                    const { data, error } = await client.auth.signInWithPassword({ email, password });
                    if (error) throw error;
                    showMainContent();
                }
            } catch (err) {
                authError.textContent = err.message || "حدث خطأ أثناء الاتصال";
                authError.style.display = 'block';
            }
        });
    }

    if (btnAnon) {
        btnAnon.addEventListener('click', async () => {
            authError.style.display = 'none';
            try {
                if (client && client.auth && client.auth.signInAnonymously) {
                    const { data, error } = await client.auth.signInAnonymously();
                    if (error) throw error;
                } else {
                    const anonEmail = `guest_${Date.now()}@loome.com`;
                    const anonPass = "Guest123456!";
                    const { data, error } = await client.auth.signUp({ email: anonEmail, password: anonPass });
                    if (error) throw error;
                }
                showMainContent();
            } catch (err) {
                authError.textContent = err.message || "فشل الدخول كزائر";
                authError.style.display = 'block';
            }
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await client.auth.signOut();
            authContainer.style.display = 'block';
            mainContent.style.display = 'none';
        });
    }

    function showMainContent() {
        authContainer.style.display = 'none';
        mainContent.style.display = 'block';
        fetchPosts();
        fetchMessages();
        subscribeToMessages();
    }

    // --- إدارة المنشورات ---
    async function fetchPosts() {
        const postsContainer = document.getElementById('posts-container');
        if (!postsContainer) return;

        const { data: posts, error } = await client.from('posts').select('*').order('created_at', { ascending: false });

        if (error) {
            postsContainer.innerHTML = "<p style='color:red;'>حدث خطأ أثناء تحميل المنشورات: " + error.message + "</p>";
            return;
        }

        if (!posts || posts.length === 0) {
            postsContainer.innerHTML = "<p>لا توجد منشورات بعد. كن أول من ينشر!</p>";
            return;
        }

        postsContainer.innerHTML = posts.map(post => `
            <div style="border: 1px solid #ddd; padding: 12px; margin-bottom: 10px; border-radius: 6px; background-color: #ffffff; text-align: right;">
                <p style="margin: 0 0 8px 0; font-size: 16px; color: #333;">${post.content}</p>
                <small style="color: #777;">${new Date(post.created_at).toLocaleString('ar-EG')}</small>
            </div>
        `).join('');
    }

    const btnPost = document.getElementById('btn-post');
    if (btnPost) {
        btnPost.addEventListener('click', async () => {
            const input = document.getElementById('post-input');
            const content = input.value.trim();
            if (!content) {
                alert("يرجى كتابة نص المنشور أولاً");
                return;
            }

            const { data: { user } } = await client.auth.getUser();
            const userId = user ? user.id : null;

            const { error } = await client.from('posts').insert([{ content: content, user_id: userId }]);
            if (error) {
                alert("فشل نشر المحتوى: " + error.message);
            } else {
                input.value = '';
                fetchPosts();
            }
        });
    }

    // --- إدارة الدردشة الجماعية ---
    async function fetchMessages() {
        const chatBox = document.getElementById('chat-box');
        if (!chatBox) return;

        const { data: messages, error } = await client
            .from('messages')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            chatBox.innerHTML = "<p style='color:red;'>خطأ في تحميل الرسائل</p>";
            return;
        }

        if (!messages || messages.length === 0) {
            chatBox.innerHTML = "<p style='color:#888;'>لا توجد رسائل بعد. ابدأ المحادثة الآن!</p>";
            return;
        }

        chatBox.innerHTML = messages.map(msg => `
            <div style="margin-bottom: 8px; background: #fff; padding: 8px; border-radius: 5px; border-right: 3px solid #007bff;">
                <strong style="color: #007bff; font-size: 12px;">${msg.sender_email || 'زائر'}</strong>
                <p style="margin: 3px 0 0 0; color: #333;">${msg.content}</p>
            </div>
        `).join('');

        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function subscribeToMessages() {
        client
            .channel('public:messages')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
                fetchMessages();
            })
            .subscribe();
    }

    const btnSendChat = document.getElementById('btn-send-chat');
    if (btnSendChat) {
        btnSendChat.addEventListener('click', async () => {
            const input = document.getElementById('chat-input');
            const content = input.value.trim();
            if (!content) return;

            const { data: { user } } = await client.auth.getUser();
            const userId = user ? user.id : null;
            const senderEmail = user ? (user.email || 'زائر') : 'زائر';

            const { error } = await client.from('messages').insert([{
                content: content,
                user_id: userId,
                sender_email: senderEmail
            }]);

            if (error) {
                alert("فشل إرسال الرسالة: " + error.message);
            } else {
                input.value = '';
            }
        });
    }

    async function checkUser() {
        if (!client) return;
        const { data: { user } } = await client.auth.getUser();
        if (user) {
            showMainContent();
        }
    }

    checkUser();
});
