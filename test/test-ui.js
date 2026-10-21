// Testsida opnar notearkivet direkte etter innlogging.
// Beheld all eksisterande app-logikk og import-/redigeringsfunksjonar.
document.addEventListener("DOMContentLoaded",()=>{
 const home=document.getElementById("home-view");
 const archiveButton=document.querySelector('.sidebar [data-view="archive"]');
 if(!home||!archiveButton)return;
 const openArchive=()=>{
   const shell=document.getElementById("app-shell");
   if(shell?.classList.contains("hidden"))return;
   if(!home.classList.contains("hidden"))archiveButton.click();
 };
 new MutationObserver(openArchive).observe(home,{attributes:true,attributeFilter:["class"]});
 new MutationObserver(openArchive).observe(document.getElementById("app-shell"),{attributes:true,attributeFilter:["class"]});
 openArchive();
});
