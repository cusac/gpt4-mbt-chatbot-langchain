sudo su -

wget johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz

mkdir ffmpeg-release-amd64-static

tar -xf ffmpeg-release-amd64-static.tar.xz --strip-components=1 -C ffmpeg-release-amd64-static

rm -f ffmpeg-release-amd64-static.tar.xz

ln -s /root/ffmpeg-release-amd64-static/ffmpeg /usr/local/bin/ffmpeg