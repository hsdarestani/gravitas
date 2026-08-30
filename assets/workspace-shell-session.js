(function(){
'use strict';
function cookie(name){var parts=(document.cookie||'').split(';');for(var i=0;i<parts.length;i++){var v=parts[i].trim();if(v.indexOf(name+'=')===0)return decodeURIComponent(v.slice(name.length+1))}return ''}
function csrf(){return fetch('/api/auth/csrf/',{credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error('csrf_failed');return r})}
function me(){return fetch('/api/auth/me/',{credentials:'same-origin',headers:{Accept:'application/json'}}).then(function(r){if(!r.ok)throw new Error('auth_failed');return r.json()})}
var saved=localStorage.getItem('gravitas-theme');if(saved)document.documentElement.dataset.theme=saved;
var theme=document.getElementById('ws-theme');if(theme)theme.addEventListener('click',function(){var next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('gravitas-theme',next)});
csrf().then(me).then(function(d){if(!d.authenticated){location.href='/login';return}var user=document.getElementById('ws-user'),avatar=document.getElementById('ws-avatar');if(user)user.textContent=d.user.email;if(avatar)avatar.textContent=(d.user.name||d.user.email||'G').charAt(0).toUpperCase()}).catch(function(){location.href='/login'});
var logout=document.getElementById('ws-logout');if(logout)logout.addEventListener('click',function(){logout.disabled=true;csrf().then(function(){return fetch('/api/auth/logout/',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json','X-CSRFToken':cookie('csrftoken')},body:'{}'})}).then(function(){location.href='/'}).catch(function(){logout.disabled=false})});
})();
