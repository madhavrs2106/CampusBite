-- CampusBite 100% Vegetarian & Egg-Free Development Seed Data
-- Realistic sample menu items for development across all required vegetarian categories.
-- Note: Sample items must be treated as development data until ingredients are verified by the canteen operator.

insert into public.categories(name, is_active) values
  ('Breakfast', true),
  ('North Indian', true),
  ('South Indian', true),
  ('Snacks', true),
  ('Street Food', true),
  ('Sandwiches and Burgers', true),
  ('Rice and Meals', true),
  ('Pizza and Bakery', true),
  ('Sweets and Desserts', true),
  ('Beverages', true)
on conflict (name) do nothing;

insert into public.menu_items(
  category_id, name, description, price_paise,
  is_available, is_active, is_vegetarian, contains_egg, ingredients_verified
)
select
  c.id, v.name, v.description, v.price_paise,
  true, true, true, false, true
from (values
  ('Breakfast', 'Poha', 'Flattened rice tempered with mustard seeds, curry leaves, turmeric, roasted peanuts & lemon', 4000),
  ('Breakfast', 'Aloo Paratha', 'Spiced potato stuffed whole wheat flatbread served with fresh curd & pickle', 6000),
  ('Breakfast', 'Paneer Paratha', 'Fresh grated paneer & herbs stuffed whole wheat flatbread served with white butter & curd', 8000),
  ('Breakfast', 'Idli Sambar', 'Steamed fermented rice & lentil cakes served with piping hot drumstick sambar & coconut chutney', 5000),
  ('South Indian', 'Masala Dosa', 'Crispy golden fermented crepe stuffed with spiced potato mash, served with sambar & chutney', 7500),
  ('South Indian', 'Plain Dosa', 'Crisp rice and lentil crepe served with flavorful lentil sambar and coconut chutney', 6000),
  ('Sandwiches and Burgers', 'Veg Sandwich', 'Triple-layer toasted sandwich loaded with cucumber, tomato, potato, mint chutney & cheese', 6000),
  ('Sandwiches and Burgers', 'Veg Burger', 'Crispy spiced vegetable patty topped with lettuce, fresh tomato, cucumber & creamy veg mayo', 8000),
  ('North Indian', 'Chole Bhature', 'Spicy Punjabi chickpea curry paired with two fluffy, deep-fried leavened bhature', 11000),
  ('Rice and Meals', 'Dal Rice', 'Homestyle yellow tadka dal served over fragrant steamed basmati rice with pickle', 7000),
  ('Rice and Meals', 'Rajma Rice', 'Slow-cooked red kidney beans in thick spiced gravy paired with hot steamed basmati rice', 8500),
  ('Rice and Meals', 'Veg Fried Rice', 'Wok-tossed long-grain basmati rice with crunchy carrots, cabbage, french beans & spring onions', 9000),
  ('Street Food', 'Pav Bhaji', 'Rich, buttery spiced mashed vegetable curry served hot with butter-toasted pav and lemon', 9000),
  ('Snacks', 'Samosa', 'Crisp golden pastry triangles stuffed with spiced potatoes and green peas, served with sweet & mint chutneys', 2000),
  ('Street Food', 'Vada Pav', 'Mumbai street classic - spicy potato fritter nested inside a pav with garlic chutney & fried green chilli', 2500),
  ('Street Food', 'Veg Momos', 'Steamed Himalayan dumplings packed with finely minced vegetables and ginger, served with fiery red chutney', 7000),
  ('Snacks', 'Paneer Roll', 'Soft layered paratha wrapped around spiced grilled paneer cubes, crunchy peppers & tangy sauce', 9500),
  ('Pizza and Bakery', 'Veg Farmhouse Pizza', 'Stone-baked thin crust pizza topped with fresh tomato sauce, mozzarella, bell peppers, corn & olives', 14000),
  ('Beverages', 'Masala Chai', 'Freshly brewed strong Indian Assam tea simmered with milk, crushed cardamom, ginger and spices', 1500),
  ('Beverages', 'Filter Coffee', 'Authentic South Indian chicory-blended decoction frothed with hot creamy milk', 2500),
  ('Beverages', 'Sweet Lassi', 'Chilled churned thick yogurt beverage flavored with cardamom and saffron strands', 4500),
  ('Sweets and Desserts', 'Jalebi', 'Crisp, spiral deep-fried batter soaked in warm aromatic saffron sugar syrup', 4000),
  ('Sweets and Desserts', 'Gulab Jamun', 'Soft melt-in-mouth reduced milk dough balls fried golden and steeped in warm rose-cardamom syrup', 4000)
) as v(category_name, name, description, price_paise)
join public.categories c on c.name = v.category_name
where not exists (select 1 from public.menu_items m where m.name = v.name);
