-- Second half of wiring up the Advanced style-editor tab's Grid Spacing and
-- Card Padding sliders as real features (setupAdvancedControls() built them
-- with no preview handling and nowhere to persist, per the dead-code audit
-- follow-up). Grid Spacing reuses the existing, previously-unused
-- profiles.portfolio_spacing column; Card Padding has no existing column.

alter table profiles add column if not exists card_padding text;
