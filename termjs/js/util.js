String.prototype.startswith = function (prefix) {
        return this.indexOf(prefix) == 0;
}

String.prototype.endswith = function(suffix) {
    return this.indexOf(suffix, this.length - suffix.length) !== -1;
};


String.prototype.repeat = function(num) {
    return new Array( num + 1 ).join( this );
}

String.prototype.trim = function() {
    return this.replace(/^\s+|\s+$/g, '');
}

function blink(obj)
{
	setInterval(function(){
		obj.toggle();
	},500);
}

function getKey(ev)
{
	return ev.keyCode || ev.which;
	//return ev.which || ev.keyCode;
}

function showDate(obj)
{
	function padding(number) {

		if (number < 10)
			return "0" + number;
		return  number;
	}

	setInterval(function(){
		var now = new Date();
		var date = now.toDateString();
		var len = date.length;
		date = date.slice(0, len - 4); /* 去掉年份 */
		var time = padding(now.getHours()) +  ":" + padding(now.getMinutes()) + ":" + padding(now.getSeconds());
		//var time = now.toLocaleTimeString();
		obj.html(date + ",&nbsp;&nbsp;" + time);
	}, 1000);
}
/*
function terminalMinized(obj)
{
	var terminal = obj.parents(".terminal");
	terminal.find(".terminal-body").slideUp("fast", function(){
		terminal.find(".terminal-toolbar").fadeOut("fast", function(){
			terminal.find(".terminal-title").animate({left:'200px',top:'200px'});
		});
	});
}
function terminalMaxized(obj)
{
	var terminal = obj.parents(".terminal");
	terminal.find(".terminal-toolbar").fadeIn("fast", function(){
		terminal.find(".terminal-body").slideDown();
	});
}
*/
function showPopupMenu(ev)
{
	var ev = ev || window.event;
	var x,y;
	if (ev.pageX || ev.pageY) {
		x = ev.pageX;
		y = ev.pageY;
	} else {
		x = ev.clientX + document.body.scrollLeft - document.doby.clientLeft;
		y = ev.clientY + document.body.scrollTop - document.body.clientTop;
	}
	$("#popup-menu").css({"top":y - 10 + "px", "left":x - 7 + "px"});
	$("#popup-menu").show();
}

document.onclick=function(){
	$("#popup-menu").hide();
};

function closeWindow() {
	window.open("", "_self", "");
	window.close();
}

function get_posts()
{
    var posts = (function () {
        var json = null;
        $.ajax({
            'async': false,
            'global': false,
            'url': "/posts.json",
            'dataType': "json",
            'success': function (data) {
                json = data;
            }
        });
        return json;
    })(); 
    return posts;
}

function paddingLeft(str, len, c)
{
    var len = len || 5;
    var c = c || ' ';
    var diff = len - str.length;
    return c.repeat(diff) + str;
}

function wrap_url(url, text)
{
    var text = text || url;
    return "<a href='" +  url + "' target='blank' class='dir'>" + text + "</a>";
}
function open_url(url)
{
    var newWindow = window.open(url, "_blank");
    return wrap_url(url);
}
