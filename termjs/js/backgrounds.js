var available_backgrounds =
[
    'black',
    'img/bg1.jpg',
    'img/bg2.jpg',
    'img/bg3.jpg',
    'img/bg4.jpg',
    'img/bg5.jpg',
    'img/bg6.jpg',
    'white',
];
var current_background_index = 0;
function changeBackground() {
	var len = available_backgrounds.length;
    var bg = available_backgrounds[++current_background_index % len];
    if (bg.endswith(".jpg") || bg.endswith(".png")) { // endswith is an self-define function, import util.js first.
        bg = "url('" + bg + "')";
    }
	$("body").css({"background":bg});
}
