# SSML arrangement – trygg felles lagring

Arrangementsportalen skal bruke Firebase-prosjektet `samnanger-skulemusikklag`, men eigne samlingar.

## Viktig før publisering
GitHub Pages er statisk. Ein PIN-kode kontrollert berre i JavaScript kan omgåast. **Ikkje legg telefonnummer, e-post eller komitémeldingar i offentleg lesbare Firestore-dokument.** Eksisterande SSML-notearkiv og reglane der skal ikkje endrast utan gjennomgang.

## Foreslått datamodell
- `arrangementEvents/{eventId}`: namn, år, dato, status, administrativ eigar.
- `arrangementEvents/{eventId}/tasks/{taskId}`: tekst, utført, tidspunkt.
- `arrangementEvents/{eventId}/members/{memberId}`: namn og kontaktinformasjon.
- `arrangementEvents/{eventId}/messages/{messageId}`: avsendar, melding, tidspunkt.
- `arrangementInvites/{inviteId}`: hash av komitékode, arrangementId, utløp, aktiv.
- Tilgang bør byggjast med Firebase Authentication og server-side verifisering (Cloud Functions) som utsteder kortliva tilgangstoken eller custom claims. Eit tilfeldig invite-ID i URL er ikkje i seg sjølv nok.

## Sikkerheitskrav
1. Styremedlemmer må identifiserast med Firebase Auth og autoriserast server-side.
2. Komitékoden må kontrollerast på server, med frekvensavgrensing og moglegheit for å trekkje tilgang tilbake.
3. Firestore Security Rules må berre gi lesing/skriving til autoriserte brukarar for det aktuelle arrangementet.
4. Komitémedlemmer kan endre `done` på oppgåver og skrive meldingar; berre styret kan opprette/slette oppgåver og administrere medlemmer.
5. Ved «Lukk for komité» skal nye tilgangstoken avvisast og aktive økter tilbakekallast.
6. Verifiser eksisterande Firestore-reglar før ein deployerer nye. **Ikkje erstatt eksisterande reglar med eit enkelt testregelsett.**

## Status
Dette er spesifikasjonen for trygg Firebase-integrasjon, ikkje ei aktiv tilkopling. Eksisterande prototype lagrar framleis berre i nettlesaren. Ingen Firestore-reglar er endra.
