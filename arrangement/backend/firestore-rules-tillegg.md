# Arrangement: forslag til tillegg i eksisterande Firestore-reglar

**Ikkje publiser dette åleine.** Legg berre desse match-blokkene inn i eksisterande `match /databases/{database}/documents` etter gjennomgang. Dei eksisterande reglane for songs, PDF, contacts og apps/skulemusikken må stå urørte.

```js
function arrangementSession() {
  return request.auth != null
    && request.auth.token.ssmlArrangement == true
    && exists(/databases/$(database)/documents/arrangementAccess/sessions/$(request.auth.uid));
}
function arrangementGrant(slot) {
  let s = get(/databases/$(database)/documents/arrangementAccess/sessions/$(request.auth.uid)).data;
  return arrangementSession()
    && s.expiresAt > request.time
    && s.version == get(/databases/$(database)/documents/arrangementAccess/credentials/$(s.slot)).data.version
    && (s.role == "board" || (s.role == "committee" && s.slot == slot
      && get(/databases/$(database)/documents/arrangementEvents/$(slot)).data.open == true));
}
function arrangementBoard() {
  return arrangementGrant("board");
}
match /arrangementAccess/{doc=**} {
  allow read, write: if false;
}
match /arrangementEvents/{eventId} {
  allow read: if arrangementGrant(eventId);
  allow create, update, delete: if arrangementBoard();
  match /tasks/{taskId} {
    allow read: if arrangementGrant(eventId);
    allow create, delete: if arrangementBoard();
    allow update: if arrangementBoard() ||
      (arrangementGrant(eventId) &&
       request.resource.data.diff(resource.data).affectedKeys().hasOnly(["done"]) &&
       request.resource.data.done is bool);
  }
  match /members/{memberId} {
    allow read: if arrangementGrant(eventId);
    allow write: if arrangementBoard();
  }
  match /messages/{messageId} {
    allow read: if arrangementGrant(eventId);
    allow create: if arrangementGrant(eventId)
      && request.resource.data.keys().hasOnly(["sender","text","createdAt"])
      && request.resource.data.sender is string
      && request.resource.data.sender.size() <= 100
      && request.resource.data.text is string
      && request.resource.data.text.size() <= 2000
      && request.resource.data.createdAt == request.time;
    allow update, delete: if arrangementBoard();
  }
}
```

## Før utrulling
- Serverfunksjonar må deployerast frå ei isolert Firebase-konfigurasjon slik at eksisterande funksjonar ikkje vert sletta.
- Sett opp `SSML_ARRANGEMENT_BOOTSTRAP` som ein hemmeleg verdi; aldri legg han i GitHub.
- Initialiser styrepassord éin gong via `arrangementInitialize`, med oppsettnøkkel, deretter logg inn via `arrangementLogin`.
- Frontend må bruke Firebase Auth custom token og Firestore sanntidslyttarar.
- Før migrering må lokale arrangement lagrast/eksporterast; elles kan lokalt innhald gå tapt.
- Sikkerheitstest tilgang mellom komitear, sperring, passordbytte og eksisterande notearkiv.
- Vurder App Check og meir robust IP-basert frekvensavgrensing før produksjon.
