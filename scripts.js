//fading function depending on scroll
window.addEventListener("scroll", function() {
	if (window.innerWidth >= 768) {
		const topImage = document.querySelector(".topimg");
		const scrollPosition = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
		topImage.style.opacity = 1 - scrollPosition / 200;
	}
});