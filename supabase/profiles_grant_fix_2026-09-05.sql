-- Fixes a real, live bug: profiles' authenticated column-grant was missing
-- contact_email and cv_url (both present on the table, absent from the
-- grant). Supabase's default upsert return-representation then failed with
-- "permission denied for table profiles", silently rolling back the whole
-- write - Profile Settings' "Save Profile" button has been completely
-- non-functional as a result. Confirmed live: a distinctive bio value did
-- not persist after a successful-looking save attempt.
--
-- Same pattern as every other column-grant fix this project (profiles/
-- notify_on_mint, blockchain_coas/c2pa_embedded): revoke the table-wide
-- grant, replace it with an explicit column list covering every column
-- profiles actually has today.
--
-- Run against staging (utlgnwxulsasydqwcjgc) only for now, per the standing
-- production hold.

revoke select on profiles from anon, authenticated;
grant select (
  id, username, created_at, bio, artist_statement, website, instagram, contact_email,
  cv_file_path, gallery_image_size, gallery_aspect_ratio, full_name, has_cv, social_links,
  profile_photo_url, has_profile_photo, show_events, show_blog, image_size, cv_url,
  portfolio_style, portfolio_font_family, portfolio_font_size, header_font_size, nav_font_size,
  body_font_size, footer_font_size, header_font_family, body_title_size, body_desc_size,
  body_meta_size, body_font_family, footer_font_family, titles_size, desc_size, artwork_size,
  artist_name_color, nav_color, titles_color, desc_color, artwork_details_color, footer_text_color,
  footer_contact, show_footer_contact, portfolio_layout, portfolio_spacing, portfolio_navigation,
  header_layout, footer_style, collection_title_layout, custom_colors, custom_fonts, card_padding,
  notify_on_mint, notify_on_transfer
) on profiles to anon, authenticated;
