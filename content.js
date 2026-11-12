const defaultProject = {
  title: "¿Qué es PreClean?",
  body: "Somos un equipo de estudiantes del Politécnico Grancolombiano. PreClean nació al buscar una forma de tratar las manchas persistentes que quedan en los uniformes, especialmente en las camisas blancas."
};

const storageKey = "preclean-content-v1";

function readContent() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return { project: saved?.project ?? defaultProject, testimonials: saved?.testimonials ?? [] };
  } catch {
    return { project: defaultProject, testimonials: [] };
  }
}

const contentStore = {
  getProject: async () => readContent().project,
  listTestimonials: async ({ publishedOnly = false } = {}) =>
    readContent().testimonials.filter(item => !publishedOnly || item.status === "published"),
  saveProject: async project => {
    localStorage.setItem(storageKey, JSON.stringify({ ...readContent(), project }));
  },
  saveTestimonial: async testimonial => {
    const content = readContent();
    const previous = content.testimonials.findIndex(item => item.id === testimonial.id);
    if (previous === -1) content.testimonials.unshift(testimonial);
    else content.testimonials[previous] = testimonial;
    localStorage.setItem(storageKey, JSON.stringify(content));
  }
};

function testimonialCard(item, edit) {
  const card = document.createElement("article");
  card.className = "card";
  const name = document.createElement("h3");
  name.textContent = item.author;
  const quote = document.createElement("p");
  quote.className = "testimonial-quote";
  quote.textContent = item.quote;
  card.append(name, quote);

  if (edit) {
    const status = document.createElement("p");
    status.textContent = item.status === "published" ? "Publicado en esta vista" : "Borrador";
    const button = document.createElement("button");
    button.className = "button secondary";
    button.textContent = "Editar";
    button.addEventListener("click", () => edit(item));
    card.append(status, button);
  }
  return card;
}

async function renderPublicContent() {
  const projectFields = document.querySelectorAll("[data-project]");
  if (projectFields.length) {
    const project = await contentStore.getProject();
    for (const field of projectFields) field.textContent = project[field.dataset.project];
  }

  const container = document.getElementById("testimonials");
  if (container) {
    const published = await contentStore.listTestimonials({ publishedOnly: true });
    container.replaceChildren(...published.map(item => testimonialCard(item)));
    document.getElementById("testimonial-empty").hidden = published.length > 0;
  }
}

async function initializeEditor() {
  const projectForm = document.getElementById("project-form");
  if (!projectForm) return;

  const testimonialForm = document.getElementById("testimonial-form");
  const status = document.getElementById("editor-status");
  const list = document.getElementById("testimonial-editor-list");
  const heading = document.getElementById("testimonial-heading");
  const cancel = document.getElementById("cancel-edit");
  let editingId = null;

  const project = await contentStore.getProject();
  projectForm.elements.namedItem("title").value = project.title;
  projectForm.elements.namedItem("body").value = project.body;

  function edit(item) {
    editingId = item.id;
    testimonialForm.elements.namedItem("author").value = item.author;
    testimonialForm.elements.namedItem("quote").value = item.quote;
    testimonialForm.elements.namedItem("status").value = item.status;
    heading.textContent = "Editar testimonio";
    cancel.hidden = false;
    testimonialForm.elements.namedItem("author").focus();
  }

  function resetEditor() {
    editingId = null;
    testimonialForm.reset();
    heading.textContent = "Agregar testimonio";
    cancel.hidden = true;
  }

  async function renderList() {
    const items = await contentStore.listTestimonials();
    if (items.length) list.replaceChildren(...items.map(item => testimonialCard(item, edit)));
    else list.textContent = "Todavía no hay testimonios guardados.";
  }

  cancel.addEventListener("click", resetEditor);

  projectForm.addEventListener("submit", async event => {
    event.preventDefault();
    const values = new FormData(projectForm);
    const title = values.get("title").trim();
    const body = values.get("body").trim();
    if (!title || !body) {
      status.textContent = "Completa el título y la descripción.";
      return;
    }
    try {
      await contentStore.saveProject({ title, body });
      status.textContent = "Contenido guardado en este navegador.";
    } catch {
      status.textContent = "El navegador no pudo guardar el cambio.";
    }
  });

  testimonialForm.addEventListener("submit", async event => {
    event.preventDefault();
    const values = new FormData(testimonialForm);
    const author = values.get("author").trim();
    const quote = values.get("quote").trim();
    if (!author || !quote) {
      status.textContent = "Completa el nombre público y el testimonio.";
      return;
    }
    try {
      await contentStore.saveTestimonial({
        id: editingId ?? crypto.randomUUID(),
        author,
        quote,
        status: values.get("status")
      });
      resetEditor();
      await renderList();
      status.textContent = "Testimonio guardado en este navegador.";
    } catch {
      status.textContent = "El navegador no pudo guardar el testimonio.";
    }
  });

  await renderList();
}

renderPublicContent();
initializeEditor();
window.addEventListener("storage", event => {
  if (event.key === storageKey) renderPublicContent();
});
