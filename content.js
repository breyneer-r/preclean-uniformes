import { supabase } from "./supabase-client.js";
import { getCurrentProfile, startAdminSession, isAdmin } from "./auth.js";
import { initializeMedia } from "./media.js";

const defaultProject = {
  title: "¿Qué es PreClean?",
  body: "Somos un equipo de estudiantes del Politécnico Grancolombiano. PreClean nació al buscar una forma de tratar las manchas persistentes que quedan en los uniformes, especialmente en las camisas blancas."
};

const contentStore = {
  async getProject() {
    const { data, error } = await supabase.from("site_content").select("title,content")
      .eq("content_key", "project").eq("is_published", true).maybeSingle();
    if (error || !data) return defaultProject;
    return { title: data.title || defaultProject.title, body: data.content || defaultProject.body };
  },
  async listTestimonials({ publishedOnly = false } = {}) {
    let query = supabase.from("testimonials").select("id,author,quote,status,created_by")
      .order("created_at", { ascending: false });
    if (publishedOnly) query = query.eq("status", "published");
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },
  async saveProject(project, { user, submit = false, draftId = null }) {
    if (isAdmin(user)) {
      const { error } = await supabase.from("site_content").upsert({
        content_key: "project", title: project.title, content: project.body,
        is_published: true, updated_at: new Date().toISOString(), updated_by: user.session.user.id
      }, { onConflict: "content_key" });
      if (error) throw error;
      return "Proyecto publicado.";
    }
    if (draftId) {
      const { error } = await supabase.from("content_submissions").update({
        payload: project, status: submit ? "pending" : "draft", updated_at: new Date().toISOString()
      }).eq("id", draftId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("content_submissions").insert({
        content_key: "project", payload: project, status: submit ? "pending" : "draft",
        created_by: user.session.user.id
      });
      if (error) throw error;
    }
    return submit ? "Enviado para aprobación." : "Borrador guardado.";
  }
};

function makeCard(item, edit) {
  const card = document.createElement("article");
  card.className = "card";
  const name = document.createElement("h3"); name.textContent = item.author;
  const quote = document.createElement("p"); quote.className = "testimonial-quote"; quote.textContent = item.quote;
  card.append(name, quote);
  if (edit) {
    const state = document.createElement("p"); state.textContent = `Estado: ${item.status}`; card.append(state);
    if (item.status === "draft") {
      const button = document.createElement("button"); button.className = "button secondary";
      button.textContent = "Editar"; button.addEventListener("click", () => edit(item)); card.append(button);
      const submit = document.createElement("button"); submit.className = "button";
      submit.textContent = "Enviar para aprobación";
      submit.addEventListener("click", async () => {
        const { error } = await supabase.from("testimonials").update({ status: "pending" }).eq("id", item.id);
        if (error) alert("No se pudo enviar el testimonio. Verifica tus permisos."); else location.reload();
      }); card.append(submit);
    }
  }
  return card;
}

async function renderPublicContent() {
  const fields = document.querySelectorAll("[data-project]");
  if (fields.length) {
    try {
      const project = await contentStore.getProject();
      for (const field of fields) if (project[field.dataset.project]) field.textContent = project[field.dataset.project];
    } catch { /* Mantener el HTML original como contenido alternativo. */ }
  }
  const container = document.getElementById("testimonials");
  if (container) {
    try {
      const list = await contentStore.listTestimonials({ publishedOnly: true });
      if (list.length) {
        container.replaceChildren(...list.map(item => makeCard(item)));
        const empty = document.getElementById("testimonial-empty"); if (empty) empty.hidden = true;
      }
    } catch { /* Mantener aviso y contenido HTML si Supabase no responde. */ }
  }
  const video = document.querySelector("#videos video");
  if (video) {
    try {
      const { data, error } = await supabase.from("media_assets").select("public_path,kind,mime_type")
        .eq("content_key", "videos").eq("kind", "video").eq("status", "published").order("created_at", { ascending: false });
      if (!error && data?.length) {
        const { data: url } = supabase.storage.from("preclean-media").getPublicUrl(data[0].public_path);
        video.replaceChildren(); const source = document.createElement("source");
        source.src = url.publicUrl; source.type = data[0].mime_type;
        video.append(source); video.load();
      }
    } catch { /* El video local permanece como respaldo. */ }
  }
}

async function initializeEditor() {
  const form = document.getElementById("project-form");
  if (!form) return;
  const status = document.getElementById("editor-status");
  let user;
  try { user = await startAdminSession(); } catch (error) { status.textContent = error.message; return; }
  if (!user) return;
  const role = user.profile.role;
  const isAdminUser = isAdmin(user);
  const submitProject = document.getElementById("submit-project");
  submitProject.hidden = isAdminUser;
  const testForm = document.getElementById("testimonial-form");
  const testList = document.getElementById("testimonial-editor-list");
  const reviewQueue = document.getElementById("review-queue");
  const cancel = document.getElementById("cancel-edit");
  const heading = document.getElementById("testimonial-heading");
  let editingTestimonial = null;
  let projectDraftId = null;
  const { data: published } = await supabase.from("site_content").select("title,content")
    .eq("content_key", "project").eq("is_published", true).maybeSingle();
  const { data: ownDraft } = await supabase.from("content_submissions").select("id,payload")
    .eq("content_key", "project").eq("created_by", user.session.user.id).eq("status", "draft")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const project = ownDraft?.payload || (published ? { title: published.title, body: published.content } : defaultProject);
  projectDraftId = ownDraft?.id || null;
  form.elements.namedItem("title").value = project.title;
  form.elements.namedItem("body").value = project.body;
  async function saveProject(submit) {
    const values = new FormData(form);
    const payload = { title: String(values.get("title")).trim(), body: String(values.get("body")).trim() };
    if (!payload.title || !payload.body) { status.textContent = "Completa el título y la descripción."; return; }
    try {
      status.textContent = await contentStore.saveProject(payload, { user, submit, draftId: projectDraftId });
      if (!isAdminUser && !projectDraftId) {
        const { data } = await supabase.from("content_submissions").select("id").eq("content_key", "project")
          .eq("created_by", user.session.user.id).eq("status", submit ? "pending" : "draft")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        projectDraftId = data?.id || null;
      }
      await renderReviewQueue();
    } catch (error) { status.textContent = `No se pudo guardar: ${error.message}`; }
  }
  form.addEventListener("submit", event => { event.preventDefault(); saveProject(false); });
  submitProject.addEventListener("click", () => saveProject(true));

  function editTestimonial(item) {
    editingTestimonial = item.id;
    testForm.elements.namedItem("author").value = item.author;
    testForm.elements.namedItem("quote").value = item.quote;
    heading.textContent = "Editar testimonio"; cancel.hidden = false;
  }
  cancel.addEventListener("click", () => { editingTestimonial = null; testForm.reset(); cancel.hidden = true; heading.textContent = "Agregar testimonio"; });
  testForm.addEventListener("submit", async event => {
    event.preventDefault(); const values = new FormData(testForm);
    const payload = { author: String(values.get("author")).trim(), quote: String(values.get("quote")).trim(),
      status: isAdminUser ? "pending" : (values.get("status") === "pending" ? "pending" : "draft"),
      created_by: user.session.user.id, updated_at: new Date().toISOString() };
    try {
      const result = editingTestimonial
        ? await supabase.from("testimonials").update(payload).eq("id", editingTestimonial)
        : await supabase.from("testimonials").insert(payload);
      if (result.error) throw result.error;
      testForm.reset(); editingTestimonial = null; cancel.hidden = true;
      heading.textContent = "Agregar testimonio"; status.textContent = "Testimonio guardado para revisión.";
      await renderEditorList(); await renderReviewQueue();
    } catch (error) { status.textContent = `No se pudo guardar el testimonio: ${error.message}`; }
  });

  async function renderEditorList() {
    const { data, error } = await supabase.from("testimonials").select("id,author,quote,status,created_by")
      .order("created_at", { ascending: false });
    if (error) { testList.textContent = `No se pudieron cargar los testimonios: ${error.message}`; return; }
    testList.replaceChildren(...(data || []).map(item => {
      const card = makeCard(item, (isAdminUser || (item.status === "draft" && item.created_by === user.session.user.id)) ? editTestimonial : null);
      if (isAdminUser) {
        const remove = document.createElement("button"); remove.className = "button secondary"; remove.textContent = "Eliminar";
        remove.addEventListener("click", async () => {
          const { error: deleteError } = await supabase.from("testimonials").delete().eq("id", item.id);
          if (deleteError) status.textContent = `No se pudo eliminar: ${deleteError.message}`;
          else { await renderEditorList(); await renderReviewQueue(); }
        }); card.append(remove);
      }
      return card;
    }));
    if (!data?.length) testList.textContent = "Todavía no hay testimonios guardados.";
  }
  async function review(table, id, decision) {
    const fn = table === "content_submissions" ? "preclean_review_submission" : "preclean_review_testimonial";
    const { error } = await supabase.rpc(fn, { p_id: id, p_decision: decision, p_note: null });
    if (error) { status.textContent = `No se pudo revisar: ${error.message}`; return; }
    status.textContent = decision === "approved" ? "Cambio aprobado y publicado." : "Cambio rechazado.";
    await renderReviewQueue(); await renderEditorList(); await renderPublicContent();
  }
  async function renderReviewQueue() {
    reviewQueue.replaceChildren();
    if (!isAdminUser) { reviewQueue.textContent = "Solo administradoras pueden revisar y aprobar cambios."; return; }
    const [submissions, testimonials] = await Promise.all([
      supabase.from("content_submissions").select("id,content_key,payload,created_by").eq("status", "pending"),
      supabase.from("testimonials").select("id,author,quote,created_by").eq("status", "pending")
    ]);
    if (submissions.error || testimonials.error) { reviewQueue.textContent = "No fue posible cargar los cambios pendientes. Revisa RLS."; return; }
    const items = [ ...(submissions.data || []).map(x => ({ ...x, type: "content_submissions", label: `Proyecto: ${x.payload.title || ""}`, detail: x.payload.body || "" })),
      ...(testimonials.data || []).map(x => ({ ...x, type: "testimonials", label: `Testimonio: ${x.author}`, detail: x.quote })) ];
    for (const item of items) {
      const card = document.createElement("article"); card.className = "card";
      const title = document.createElement("h3"); title.textContent = item.label;
      const detail = document.createElement("p"); detail.textContent = item.detail;
      card.append(title, detail);
      for (const [decision, label] of [["approved", "Aprobar y publicar"], ["rejected", "Rechazar"]]) {
        const button = document.createElement("button"); button.className = decision === "approved" ? "button" : "button secondary";
        button.textContent = label; button.addEventListener("click", () => review(item.type, item.id, decision)); card.append(button);
      }
      reviewQueue.append(card);
    }
    if (!items.length) reviewQueue.textContent = "No hay cambios pendientes.";
  }
  async function renderUsers() {
    const section = document.getElementById("user-management");
    const list = document.getElementById("user-list");
    if (!section || !list) return;
    section.hidden = !isAdminUser;
    if (!isAdminUser) return;
    const { data, error } = await supabase.from("profiles").select("id,email,full_name,role").order("email");
    if (error) { list.textContent = `No se pudieron cargar perfiles: ${error.message}`; return; }
    list.replaceChildren(...(data || []).map(profile => {
      const card = document.createElement("article"); card.className = "card";
      const label = document.createElement("p"); label.textContent = `${profile.full_name || profile.email || profile.id} · ${profile.role}`;
      card.append(label);
      if (profile.id !== user.session.user.id) {
        const select = document.createElement("select"); select.setAttribute("aria-label", `Rol de ${profile.email || profile.id}`);
        for (const roleName of ["editor", "admin"]) { const option = document.createElement("option"); option.value = roleName; option.textContent = roleName; option.selected = profile.role === roleName; select.append(option); }
        const save = document.createElement("button"); save.className = "button secondary"; save.textContent = "Guardar rol";
        save.addEventListener("click", async () => {
          const { error: roleError } = await supabase.rpc("preclean_set_role", { p_user_id: profile.id, p_role: select.value });
          status.textContent = roleError ? `No se pudo cambiar el rol: ${roleError.message}` : "Rol actualizado.";
          if (!roleError) renderUsers();
        }); card.append(select, save);
      }
      return card;
    }));
  }
  await renderEditorList(); await renderReviewQueue();
  await renderUsers();
  initializeMedia(user, status);
}

renderPublicContent();
initializeEditor();
