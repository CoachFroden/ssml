const PART_ORDER = [
  { rank: 0, pattern: /partitur|full score|score|conductor|dirigent/ },
  { rank: 10, pattern: /piccolo|pikkolo|\bpicc\.?\b/ },
  { rank: 20, pattern: /fløyte|floyte|flute/ },
  { rank: 30, pattern: /oboe|\bobo\b/ },
  { rank: 35, pattern: /engelsk horn|english horn|cor anglais/ },
  { rank: 40, pattern: /kontrafagott|contrabassoon/ },
  { rank: 41, pattern: /fagott|bassoon/ },

  // Klarinettfamilien: dei mest spesifikke namna må testast før «klarinett».
  { rank: 50, pattern: /(^|\s)(ess|eb|e-flat|e flat|e♭)[-\s]*(klarinett|clarinet)(\s|$)/ },
  { rank: 70, pattern: /kontra[-\s]*altklarinett|contra[-\s]*alto clarinet/ },
  { rank: 71, pattern: /altklarinett|alto clarinet/ },
  { rank: 80, pattern: /kontrabassklarinett|contrabass clarinet/ },
  { rank: 81, pattern: /bassklarinett|bass clarinet/ },
  { rank: 60, pattern: /klarinett|clarinet/ },

  { rank: 100, pattern: /sopransaksofon|soprano sax/ },
  { rank: 110, pattern: /altsaksofon|alto sax/ },
  { rank: 120, pattern: /tenorsaksofon|tenor sax/ },
  { rank: 130, pattern: /barytonsaksofon|baritonsaksofon|baritone sax|bari sax/ },

  // Messing. Trumpetar/kornettar kjem før horn, slik instrumentlista i notesetta gjer.
  { rank: 140, pattern: /kornett|cornet/ },
  { rank: 141, pattern: /trompet|trumpet/ },
  { rank: 142, pattern: /flygelhorn|flugelhorn/ },
  { rank: 150, pattern: /althorn|alto horn|tenorhorn|tenor horn|french horn|f-horn|\bhorn\b/ },
  { rank: 160, pattern: /basstrombone|bass trombone/ },
  { rank: 161, pattern: /trombone/ },
  { rank: 170, pattern: /baryton|baritone|eufonium|euphonium/ },
  { rank: 180, pattern: /tuba/ },
  { rank: 190, pattern: /strykebass|string bass|double bass|contrabass|kontrabass/ },
  { rank: 195, pattern: /elektrisk bass|electric bass|bass guitar/ },

  // Slagverk blir finjustert i rankFor slik at Perc. 1 → Drum Set → Perc. 2 → Mallet → Timpani.
  { rank: 200, pattern: /trommesett|drum set|drumset|drums/ },
  { rank: 200, pattern: /melodisk slagverk|mallet percussion|mallet|xylophone|xylofon|glockenspiel|bells|klokkespill|vibraphone|vibes|vibrafon|marimba/ },
  { rank: 200, pattern: /pauker|timpani/ },
  { rank: 200, pattern: /slagverk|percussion/ }
];

function normalized(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function rankFor(name = "") {
  const text = normalized(name);
  const voice = Number(text.match(/\b([1-9])\b/)?.[1] || 0);

  // Hal Leonard-/concert-band-rekkefølge for slagverk.
  if (/pauker|timpani/.test(text)) return 20400;
  if (/melodisk slagverk|mallet percussion|mallet|xylophone|xylofon|glockenspiel|bells|klokkespill|vibraphone|vibes|vibrafon|marimba/.test(text)) return 20300 + voice;
  if (/trommesett|drum set|drumset|drums/.test(text)) return 20100;
  if (/slagverk|percussion/.test(text)) {
    if (voice === 1) return 20000;
    if (voice >= 2) return 20200 + voice;
    return 20000;
  }

  const match = PART_ORDER.find(item => item.pattern.test(text));
  return (match?.rank ?? 9999) * 100 + voice;
}

function rowName(row, type) {
  if (type === "review") return row.querySelector(".review-part-name")?.value || "";
  return row.querySelector("strong")?.textContent || "";
}

function sortContainer(container, selector, type) {
  if (!container) return;
  const rows = [...container.querySelectorAll(`:scope > ${selector}`)];
  if (rows.length < 2) return;

  const sorted = [...rows].sort((a, b) => {
    const nameA = rowName(a, type);
    const nameB = rowName(b, type);
    return rankFor(nameA) - rankFor(nameB)
      || nameA.localeCompare(nameB, "no", { numeric: true });
  });

  if (rows.every((row, index) => row === sorted[index])) return;
  const fragment = document.createDocumentFragment();
  sorted.forEach(row => fragment.append(row));
  container.append(fragment);
}

let scheduled = false;
function sortInstrumentLists() {
  scheduled = false;
  sortContainer(document.querySelector("#part-list"), ".part-select-row", "list");
  sortContainer(document.querySelector("#review-parts"), ".review-part-row", "review");
}

function scheduleSort() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(sortInstrumentLists);
}

const observer = new MutationObserver(scheduleSort);
observer.observe(document.body, { childList: true, subtree: true });
document.addEventListener("input", event => {
  if (event.target?.classList?.contains("review-part-name")) scheduleSort();
});

scheduleSort();
