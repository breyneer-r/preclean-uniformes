import { supabase } from "./supabase-client.js";

export async function getCurrentProfile() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) return null;
  const { data: profile, error } = await supabase
    .from("profiles").select("id,email,full_name,role").eq("id", session.user.id).maybeSingle();
  if (error) throw error;
  if (!profile || !["admin", "editor"].includes(profile.role)) {
    throw new Error("Tu cuenta no tiene un perfil o rol habilitado. Contacta a una administradora.");
  }
  return { session, profile };
}

export function isAdmin(user) { return user?.profile?.role === "admin"; }

export async function startAdminSession() {
  const login = document.getElementById("login-form");
  const panel = document.getElementById("admin-workspace");
  const loginBox = document.getElementById("admin-login");
  const status = document.getElementById("auth-status");
  const identity = document.getElementById("auth-identity");
  const logout = document.getElementById("logout-button");
  if (!login || !panel) return null;

  const show = async () => {
    try {
      const user = await getCurrentProfile();
      panel.hidden = !user;
      loginBox.hidden = Boolean(user);
      logout.hidden = !user;
      if (user) {
        identity.textContent = `${user.profile.full_name || user.profile.email || user.session.user.email} · ${user.profile.role}`;
        status.textContent = "";
      }
      return user;
    } catch (error) {
      panel.hidden = true;
      loginBox.hidden = false;
      status.textContent = error.message || "No fue posible verificar tu sesión.";
      return null;
    }
  };

  login.addEventListener("submit", async event => {
    event.preventDefault();
    status.textContent = "Ingresando…";
    const values = new FormData(login);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(values.get("email")).trim(), password: String(values.get("password"))
    });
    if (error) {
      status.textContent = "No se pudo iniciar sesión. Verifica el correo y la contraseña.";
      return;
    }
    await show();
  });
  logout.addEventListener("click", async () => {
    status.textContent = "Cerrando sesión…";
    const { error } = await supabase.auth.signOut();
    if (error) status.textContent = "No se pudo cerrar sesión. Inténtalo de nuevo.";
    await show();
  });
  const initial = await show();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) { panel.hidden = true; loginBox.hidden = false; logout.hidden = true; identity.textContent = ""; }
    else queueMicrotask(show);
  });
  return initial;
}
