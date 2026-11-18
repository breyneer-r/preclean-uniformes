import { supabase } from "./supabase-client.js";
import { isAdmin } from "./auth.js";

const limits = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 };
const allowed = {
  "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"],
  "video/mp4": ["mp4"], "video/webm": ["webm"]
};

export async function initializeMedia(user, status) {
  const form = document.getElementById("media-form");
  const list = document.getElementById("media-list");
  const message = document.getElementById("media-status");
  if (!form || !user) return;
  const admin = isAdmin(user);

  async function render() {
    const { data, error } = await supabase.from("media_assets")
      .select("id,content_key,kind,draft_path,public_path,original_name,mime_type,size_bytes,status,created_by")
      .order("created_at", { ascending: false });
    list.replaceChildren();
    if (error) { list.textContent = `No se pudieron listar los archivos: ${error.message}`; return; }
    for (const item of data || []) {
      const card = document.createElement("article"); card.className = "card";
      const name = document.createElement("h3"); name.textContent = item.original_name;
      const detail = document.createElement("p"); detail.textContent = `${item.kind} · ${item.status} · ${item.content_key}`;
      card.append(name, detail);
      const path = item.status === "published" ? item.public_path : item.draft_path;
      const bucket = item.status === "published" ? "preclean-media" : "preclean-drafts";
      if (item.status === "published" || item.created_by === user.session.user.id || admin) {
        if (item.status === "published") {
          const { data: url } = supabase.storage.from(bucket).getPublicUrl(path);
          const preview = item.kind === "image" ? document.createElement("img") : document.createElement("video");
          preview.src = url.publicUrl; if (item.kind === "video") preview.controls = true;
          preview.alt = item.kind === "image" ? item.original_name : ""; preview.style.maxHeight = "240px"; card.append(preview);
        } else {
          const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
          if (signed?.signedUrl) {
            const preview = item.kind === "image" ? document.createElement("img") : document.createElement("video");
            preview.src = signed.signedUrl; if (item.kind === "video") preview.controls = true;
            preview.alt = item.kind === "image" ? item.original_name : ""; preview.style.maxHeight = "240px"; card.append(preview);
          }
        }
      }
      if (item.status === "draft" && item.created_by === user.session.user.id) {
        const submit = document.createElement("button"); submit.className = "button"; submit.textContent = "Enviar para aprobación";
        submit.addEventListener("click", async () => {
          const { error: updateError } = await supabase.from("media_assets").update({ status: "pending" }).eq("id", item.id);
          if (updateError) message.textContent = `No se pudo enviar: ${updateError.message}`; else await render();
        }); card.append(submit);
        const remove = document.createElement("button"); remove.className = "button secondary"; remove.textContent = "Eliminar borrador";
        remove.addEventListener("click", async () => {
          const { error: dbError } = await supabase.from("media_assets").delete().eq("id", item.id);
          if (dbError) { message.textContent = `No se pudo eliminar: ${dbError.message}`; return; }
          await supabase.storage.from("preclean-drafts").remove([item.draft_path]); await render();
        }); card.append(remove);
      }
      if (admin && item.status === "pending") {
        const approve = document.createElement("button"); approve.className = "button"; approve.textContent = "Aprobar y publicar";
        approve.addEventListener("click", async () => {
          message.textContent = "Publicando archivo…";
          const { data: blob, error: downloadError } = await supabase.storage.from("preclean-drafts").download(item.draft_path);
          if (downloadError) { message.textContent = `No se pudo leer el borrador: ${downloadError.message}`; return; }
          const publicPath = `${item.content_key}/${item.id}.${item.original_name.split(".").pop().toLowerCase()}`;
          const { error: uploadError } = await supabase.storage.from("preclean-media").upload(publicPath, blob, {
            contentType: item.mime_type, upsert: false, cacheControl: "3600"
          });
          if (uploadError) { message.textContent = `No se pudo copiar al bucket público: ${uploadError.message}`; return; }
          const { error: rpcError } = await supabase.rpc("preclean_review_media", {
            p_id: item.id, p_decision: "approved", p_public_path: publicPath, p_note: null
          });
          if (rpcError) {
            await supabase.storage.from("preclean-media").remove([publicPath]);
            message.textContent = `La aprobación falló; se limpió el archivo público: ${rpcError.message}`; return;
          }
          message.textContent = "Archivo aprobado y publicado."; await render();
        }); card.append(approve);
        const reject = document.createElement("button"); reject.className = "button secondary"; reject.textContent = "Rechazar";
        reject.addEventListener("click", async () => {
          const { error: rejectError } = await supabase.rpc("preclean_review_media", {
            p_id: item.id, p_decision: "rejected", p_public_path: null, p_note: null
          });
          if (rejectError) message.textContent = `No se pudo rechazar: ${rejectError.message}`; else await render();
        }); card.append(reject);
      }
      if (admin) {
        const remove = document.createElement("button"); remove.className = "button secondary"; remove.textContent = "Eliminar archivo";
        remove.addEventListener("click", async () => {
          for (const [bucketToRemove, pathToRemove] of [["preclean-drafts", item.draft_path], ["preclean-media", item.public_path]]) {
            if (!pathToRemove) continue;
            const { error: storageError } = await supabase.storage.from(bucketToRemove).remove([pathToRemove]);
            if (storageError) { message.textContent = `No se pudo eliminar el archivo: ${storageError.message}`; return; }
          }
          const { error: dbError } = await supabase.from("media_assets").delete().eq("id", item.id);
          if (dbError) { message.textContent = `Se quitó el archivo almacenado, pero no el registro: ${dbError.message}`; return; }
          await render();
        }); card.append(remove);
      }
      list.append(card);
    }
    if (!data?.length) list.textContent = "Todavía no hay archivos cargados.";
  }

  form.addEventListener("submit", async event => {
    event.preventDefault(); message.textContent = "";
    const file = form.elements.namedItem("file").files[0];
    const key = form.elements.namedItem("content_key").value;
    const extensions = allowed[file?.type];
    const ext = file?.name.split(".").pop().toLowerCase();
    if (!file || !extensions?.includes(ext)) { message.textContent = "Tipo de archivo no permitido. Usa JPEG, PNG, WebP, MP4 o WebM."; return; }
    const kind = file.type.startsWith("image/") ? "image" : "video";
    if (file.size > limits[kind]) { message.textContent = kind === "image" ? "La imagen supera 10 MiB." : "El video supera 100 MiB."; return; }
    const id = crypto.randomUUID(); const path = `${user.session.user.id}/${id}.${ext}`;
    message.textContent = "Subiendo archivo privado…";
    const { error: uploadError } = await supabase.storage.from("preclean-drafts").upload(path, file, {
      contentType: file.type, upsert: false
    });
    if (uploadError) { message.textContent = `No se pudo subir el archivo. Revisa bucket/policies: ${uploadError.message}`; return; }
    const { error: insertError } = await supabase.from("media_assets").insert({
      id, content_key: key, kind, draft_path: path, original_name: file.name,
      mime_type: file.type, size_bytes: file.size, status: "draft", created_by: user.session.user.id
    });
    if (insertError) {
      await supabase.storage.from("preclean-drafts").remove([path]);
      message.textContent = `No se guardaron los datos del archivo: ${insertError.message}`; return;
    }
    form.reset(); message.textContent = "Archivo guardado como borrador privado."; await render();
  });
  await render();
}
