# Creación controlada del administrador

El registro público está deshabilitado (`enable_signup = false`). Para crear al administrador:

1. En Supabase Dashboard → **Authentication → Users → Add user**, crea el usuario con correo y
   contraseña robusta (marca "Auto Confirm User"). La contraseña nunca se comparte ni se guarda en el repo.
2. En **SQL Editor** ejecuta (reemplaza el correo):

```sql
insert into public.profiles (id, role, full_name)
select id, 'admin', 'Propietario' from auth.users where email = 'CORREO_DEL_ADMIN'
on conflict (id) do update set role = 'admin';
```

3. En **Authentication → Providers → Email** confirma que "Allow new users to sign up" esté apagado
   en el proyecto Cloud (el `config.toml` solo aplica al entorno local).
4. En **Authentication → URL Configuration** define Site URL y Redirect URLs con la URL de GitHub Pages.
