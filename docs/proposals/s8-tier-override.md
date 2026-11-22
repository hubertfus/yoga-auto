# S8 → S3: lokalny override tieru (`usePerfTier().override`)

W brief S8 jest mowa o `usePerfTier().override`, ale w glass-ui go nie ma (`perf.tsx`, README). S8 obchodzi to bez zmian w S3: `features/map/tierDrop.ts` ustawia `data-tier="lite"` na `<html>` na czas panningu/zoomu i przywraca `perfStore.applyCurrent()` (publiczny eksport). Ograniczenia: zmienia tylko zmienne CSS tieru (blur/saturacja), nie `surfaces.setLimit` ani skali refrakcji.
Prośba (opcjonalna): `perfStore.pushOverride(tier): () => void` (licznik, zwalnia limit powierzchni i refrakcję) + `usePerfTier().override`. Wtedy `tierDrop.ts` przełączę na nie jedną linijką.
