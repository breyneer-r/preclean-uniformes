// Pega aquí el enlace oficial de WhatsApp que confirme el equipo.
const whatsappUrl = "https://wa.me/573197517602";

function connectWhatsApp() {
  if (!whatsappUrl) return;

  const base = new URL(whatsappUrl);
  const allowedHosts = ["wa.me", "api.whatsapp.com", "www.whatsapp.com", "whatsapp.com"];
  if (base.protocol !== "https:" || !allowedHosts.includes(base.hostname)) return;

  const messages = {
    consulta: "¡Hola, equipo de PreClean! Vi su blog y me gustaría conocer más sobre su prototipo en dos pasos. Tengo una consulta sobre una mancha en mi uniforme. ¿Puedo contarles qué pasó?",
    compra: "¡Hola, equipo de PreClean! Me interesa su producto para el cuidado de uniformes. ¿Podrían avisarme cuando esté disponible para comprar y contarme cómo conseguirlo?"
  };

  for (const [id, message] of Object.entries(messages)) {
    const link = document.getElementById(id);
    const destination = new URL(base);
    if (!destination.pathname.startsWith("/message/")) {
      destination.searchParams.set("text", message);
    }
    link.href = destination;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.removeAttribute("aria-disabled");
  }
  document.getElementById("contact-status").hidden = true;
}

connectWhatsApp();
