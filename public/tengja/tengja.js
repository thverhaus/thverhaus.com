"use strict";

const form = document.getElementById("form");
const status = document.getElementById("status");
const fieldsM3u = document.getElementById("fields-m3u");
const fieldsXtream = document.getElementById("fields-xtream");

const ERRORS = {
  not_found: "Kóðinn fannst ekki eða er útrunninn. Fáðu nýjan kóða á sjónvarpinu.",
  used: "Þessi kóði hefur þegar verið notaður.",
  invalid: "Athugaðu reitina. Slóðir þurfa að byrja á http:// eða https://.",
  too_large: "Upplýsingarnar eru of langar.",
};

function show(message, isError) {
  status.textContent = message;
  status.className = isError ? "error" : "";
}

function selectedType() {
  return form.elements.type.value;
}

function syncType() {
  const xtream = selectedType() === "xtream";
  fieldsXtream.hidden = !xtream;
  fieldsM3u.hidden = xtream;
}

for (const radio of form.elements.type) radio.addEventListener("change", syncType);
syncType();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = form.elements;
  const code = f.code.value.trim();
  if (!code) return show("Sláðu inn kóðann af sjónvarpinu.", true);

  const type = selectedType();
  const payload = { type, name: f.name.value, epgUrl: f.epgUrl.value };
  if (type === "m3u") {
    payload.url = f.url.value;
  } else {
    payload.server = f.server.value;
    payload.username = f.username.value;
    payload.password = f.password.value;
  }

  const button = form.querySelector("button");
  button.disabled = true;
  show("Sendi…", false);
  try {
    const response = await fetch("/api/pair/" + encodeURIComponent(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      form.reset();
      syncType();
      show("Sent! Playlistinn birtist á sjónvarpinu eftir smástund.", false);
    } else {
      const body = await response.json().catch(() => ({}));
      show(ERRORS[body.error] || "Eitthvað fór úrskeiðis. Reyndu aftur.", true);
    }
  } catch {
    show("Náði ekki sambandi. Athugaðu netið og reyndu aftur.", true);
  } finally {
    button.disabled = false;
  }
});
