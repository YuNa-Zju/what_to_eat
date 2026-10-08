UPDATE posts SET shared_meal_id=NULL
WHERE shared_meal_id IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM meals WHERE meals.id=posts.shared_meal_id);
