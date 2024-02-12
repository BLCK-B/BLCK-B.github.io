//fading function depending on scroll
window.addEventListener("scroll", function() {
	if (window.innerWidth >= 768) {
		const topImage = document.querySelector(".graphicDesktop");
		const scrollPosition = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
		topImage.style.opacity = 1 - scrollPosition / 200;
	}
});

var text = [
    "For you cannot go back BR For now your world will turn black",
    "Keep on dreaming BR This is a new beginning",
	"It's like a black hole BR Once you get too close",
	"To reach the stage where we belong BR and where we'll both be gone",
	"Someway, somehow BR Think I've seen it before",
	"A little world we once knew BR A little marble in the blackest night",
	"Keep us up tonight BR There's nothing more to fear"
];
var currentDate = new Date();
var currentText = currentDate.getDate() % text.length;
var display = document.getElementById("snippet");
display.innerHTML = text[currentText].replace(/BR/, '<br>');