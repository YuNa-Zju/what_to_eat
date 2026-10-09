ALTER TABLE restaurants ADD COLUMN address TEXT;
ALTER TABLE restaurants ADD COLUMN location TEXT;
ALTER TABLE restaurants ADD COLUMN cover_image_id TEXT REFERENCES images(id);
CREATE INDEX restaurant_cover ON restaurants(cover_image_id);
ALTER TABLE photo_uploads ADD COLUMN restaurant_id TEXT REFERENCES restaurants(id);
