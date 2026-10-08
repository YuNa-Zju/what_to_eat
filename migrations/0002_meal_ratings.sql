ALTER TABLE meals ADD COLUMN rating INTEGER CHECK (rating IS NULL OR rating IN (-1, 0, 1));
