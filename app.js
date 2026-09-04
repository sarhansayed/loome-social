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
