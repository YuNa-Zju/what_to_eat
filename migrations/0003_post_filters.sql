CREATE INDEX posts_meal ON posts(shared_meal_id, created_at DESC, id DESC);
CREATE INDEX posts_restaurant ON posts(restaurant_id, created_at DESC, id DESC);
CREATE INDEX posts_nickname ON posts(nickname, created_at DESC, id DESC);
CREATE INDEX posts_eaten ON posts(eaten_on DESC, created_at DESC, id DESC);
