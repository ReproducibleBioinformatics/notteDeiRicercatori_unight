-- Aggiunge l'animale della spilla a un database gia' esistente.
-- Su un database nuovo la colonna c'e' gia' e questo comando risponde
-- "duplicate column name": si puo' ignorare.
ALTER TABLE participants ADD COLUMN animal INTEGER NOT NULL DEFAULT 0;
