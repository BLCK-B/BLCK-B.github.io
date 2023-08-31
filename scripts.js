//fading or scaling function depending on scroll
window.addEventListener("scroll", function() {
	const headerContent = document.querySelector(".mobilecont-content");
	const headerImage = document.querySelector(".mobilecont-image");
	const topImage = document.querySelector(".topimg");
	const scrollPosition = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

	if (window.innerWidth >= 768) {
		topImage.style.opacity = 1 - scrollPosition / 200;
	}
	else {
		const scaleValue = Math.max(0.8, 1 - scrollPosition * 0);
		const heightValue = Math.max(60, 200 - scrollPosition * 0.5);
		headerImage.style.transform = "scale(" + scaleValue + ")";
		headerContent.style.height = heightValue + "px";
	}
});

async function announcementPreview() {
	try {
		//fetching announcements page
        const response = await fetch("https://blck-b.github.io/announcements.html");
        const htmlContent = await response.text();
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = htmlContent;
		//separating the elements
        const titleElement = tempDiv.querySelector(".antitle");
        const dateElement = tempDiv.querySelector(".andate");
        let textElement = tempDiv.querySelector(".antext");
		//processing text
        let shortenedContent = textElement.textContent.slice(0, 135);
        if (shortenedContent.charAt(shortenedContent.length - 1) === " ") {
            shortenedContent = shortenedContent.slice(0, -1);
        }
        shortenedContent += "...";
     
        //assemble display container
        const displayContainer = document.createElement("p");
        displayContainer.classList.add("antext");
        displayContainer.appendChild(titleElement);
        displayContainer.appendChild(dateElement);
        textElement.textContent = shortenedContent;
        displayContainer.appendChild(textElement);

        //put display container inside target div
        const targetContainer = document.querySelector(".announcements");
        targetContainer.appendChild(displayContainer);
    } catch (error) {
        console.error("announcement preview error: ", error);
    }
}
window.onload = announcementPreview;